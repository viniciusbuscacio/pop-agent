# Agent flow — frontend ↔ pi SDK, end to end

Design detail for pop-agent.spec §5, §13, §14. The spec stays normative; this
document explains how a message travels through every layer and what each
layer maps. Update it when the flow changes.

**The frontend never touches the pi SDK.** Its entire contract is DTOs
(`@pop-agent/shared`) over HTTP + SSE. The pi SDK lives behind two boundaries:
the `AgentBridge` port (application) and its adapter (infrastructure).

## The wire (what web sees)

```
web                        server
 │  POST /v1/chats/:id/messages          SendMessageRequest DTO
 │ ────────────────────────────────────▶ { text, attachments? }
 │  202 Accepted                         SendMessageResponse DTO
 │ ◀──────────────────────────────────── { runId, userMessageId }
 │                         or, if busy:  { queued: true, message, head }
 │
 │  GET /v1/events (EventSource, one per app instance)
 │ ◀━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ StreamEvent DTOs, one per SSE frame
 │    delta → thinking → tool(start|output|done) → … → done
```

- Send is **fire-and-return**: the POST starts the run and answers immediately.
  If that chat is already running, the same POST atomically appends to its
  durable SQLite FIFO and offers the head to pi as **steering** by default. The
  FIFO accepts up to 1,024 pending inputs per chat; only the next append is
  refused with `queue_full`. The composer command `/queue <message>` sends
  `delivery: follow_up` and preserves the older behavior: do not offer that
  item to pi; wait for the run to settle. Pi inserts steering after the current
  assistant turn and its tool calls, before the next model call. Pop offers
  every contiguous steering item and explicitly sets pi's `steeringMode` to
  `all`, so the complete accepted batch enters before that model call. An
  explicit follow-up is a FIFO barrier: neither it nor later input overtakes
  the current run. If the run has not reached pi, comes from a different local
  connection, or ends first, the durable head remains a normal follow-up. The
  persisted `delivery_mode` keeps
  `/queue` explicit across edits and reconnects. ID-addressed `PUT` and
  `DELETE` routes edit or cancel any pending item; the legacy routes continue
  to target the head.
- Run events carry `chatId` + `runId`. Queue events are chat-scoped: they carry
  an incremental `upsert` or `remove`, plus the shared FIFO head for older
  clients, and a `started` user-message identity when consumed as a new run.
  `steering-delivered` closes
  the current assistant segment, inserts the steering user message and resets
  the live buffer while preserving the same run id. The frontend keeps a **runId registry**:
  stale run fragments are dropped while queue changes still reach every tab.
- Stop: `POST /v1/chats/:id/stop` → server aborts; the run's terminal
  event is `error` with code `aborted` (or `done` if it finished first).

## Layer-by-layer (server)

```
interface/http            application               infrastructure/agent
─────────────             ─────────────             ────────────────────
POST …/messages           StartRun use case         PiAgentBridge (adapter)
 Zod-validate DTO   ───▶   cap check (≤20 runs)      ensure session:
 map DTO → command         persist user message       open(pi_session_id)
                           call AgentBridge.run  ───▶  or create(sessionDir)
                                                      subscribe → session.prompt
GET /v1/events            EventSink port            pi events → AgentEvent
 SSE hub          ◀───     forward AgentEvents ◀───   (mapping table below)
 map AgentEvent →          persist assistant msg
 StreamEvent DTO           on terminal event
```

- **DTOs in, DTOs out** — domain objects never cross `interface/`.
  Inbound: Zod parse → command object for the use case. Outbound: the SSE
  hub maps application `AgentEvent`s to `StreamEvent` DTOs; route handlers
  map use-case results to response DTOs. All DTO shapes live in
  `@pop-agent/shared` so web imports the exact same types.
- **Ports owned by application** (`application/ports/`):
  - `AgentBridge.run({ chatId, prompt, model, onEvent, signal })` and
    `listModels()` — the only door to pi.
  - `ChatRepo` — persistence (SQLite adapter).
  - `EventSink.emit(event)` — the only door to connected clients (SSE hub
    adapter in `interface/`).
- The use case is transport-blind and engine-blind: swap Hono or swap pi
  (SDK → RPC subprocess) and `application/` does not change.

## PiAgentBridge internals (infrastructure/agent)

- **Session cache**: `Map<chatId, { session, lastUsedAt }>`. Idle > 3h →
  dispose and drop (spec §5); reopening via `SessionManager.open(path)` is
  transparent. `chats.pi_session_id` stores the JSONL path; first run of a
  chat uses `SessionManager.create(POP_AGENT_WORKSPACE, POP_AGENT_DATA_DIR/sessions)`
  and records the path.
- **Concurrency** is not here. The ceiling and the queue live in the
  application (`RunService`), where they belong: they are a product rule, not
  an engine detail. The bridge counts only whether a cached session is in use,
  so an idle sweep never disposes one mid-run.
- **Abort**: `signal` from the use case → `session.abort()`. Killing the
  process group of a running bash child is the SDK's own behaviour, verified
  behaviourally (see §2 below) -- aw's implementation is not needed.
- **Event mapping** (pi SDK → application `AgentEvent`); exact pi names to
  be confirmed against the SDK types when coding — this table is the
  contract the adapter must satisfy no matter what pi renames:

| pi SDK event                                        | AgentEvent          |
|-----------------------------------------------------|---------------------|
| `message_update` + `text_delta`                     | `delta { text }`    |
| `message_update` + `thinking_delta`                 | `thinking { text }` |
| `tool_execution_start`                              | `tool start`        |
| tool output updates (streamed)                      | `tool output`       |
| tool execution end (ok / error)                     | `tool done | error` |
| prompt resolved                                     | `done`              |
| abort / thrown error                                | `error { code }`    |

- Terminal handling in the use case: assemble the final assistant message
  (text + thinking + tool records) from the accumulated events, persist it
  via `ChatRepo`, then emit `done` with the persisted `messageId`.

## Frontend consumption (web)

- `services/events.ts` owns the single `EventSource`; reconnects with
  backoff; dispatches parsed `StreamEvent`s to the chat store. Components
  never see the EventSource (spec §14 services rule).
- Store keeps per-chat: persisted messages + a live buffer keyed by
  `runId`. `delta`/`thinking`/`tool` append to the buffer; `done` promotes
  the buffer to a persisted message (id from the event) and clears it.
- `run-status`, not token or tool traffic, drives the run-level line immediately
  above the composer in both clients: queued is static, running animates
  `Working…`, and the terminal `done`/`error` removes it. Spinner frames are
  local presentation and never cross SSE. Tool events only drive tool cards,
  so a finished tool cannot make an otherwise-active run look idle.
- **Reload / reconnect reconciliation**: on mount or SSE reconnect,
  refetch `GET /v1/chats/:id/messages` and merge with the live buffer by
  `runId`/`messageId` — never duplicate a message that both paths deliver
  (aw's streaming machine, spec §14).
- Send path: POST first, then append the accepted user message or the server's
  durable FIFO item. `GET .../messages` reconciles both `live` and the entire
  pending FIFO; SSE incrementally adds, edits or removes exact items on other
  devices. Pending items remain visible and editable by id, and the composer
  stays available for more input up to the defensive cap. An item is not
  deleted merely because pi accepted it: only pi's user-message event consumes
  it, advances the head and offers the next steering item. `steering-delivered`
  persists the assistant
  segment before it, inserts the user message, and continues the same run with
  an empty live buffer. If it was not delivered, run settlement starts it
  normally and broadcasts `queue.started`. Old on-device queue keys are
  uploaded once as an upgrade path and deleted only after server acceptance.

## Failure modes (design targets)

| Failure                       | Behavior                                        |
|-------------------------------|-------------------------------------------------|
| SSE drops mid-run             | client reconnects + refetches; run unaffected   |
| server restarts mid-run       | partial answer is marked interrupted; undelivered steering starts as a follow-up after boot |
| PWA/tab closes with pending input | SQLite row remains; snapshot restores it on any device |
| two tabs queue simultaneously | synchronous appends preserve both in FIFO order; only item 1,025 gets `queue_full` |
| pi throws inside a run        | `error` event with stable code; user message already persisted |
| provider auth/limit error     | `error` code surfaces the provider code; no retry loops |
| Stop pressed                  | abort + child process-group kill; terminal `error/aborted` |

## v0.1 build order for this flow

1. ✅ `AgentBridge` port + fake adapter (scripted events) → wire the full
   path with zero tokens; smoke test asserts the SSE sequence.
2. ✅ Frontend chat store + streaming UI against the fake adapter first.
3. ✅ `PiAgentBridge` with persistent sessions (`sessionDir`,
   `pi_session_id`) and the real key from the environment. The in-memory
   session manager was skipped: `tools/live-check.ts` runs against a temporary
   data directory instead, which exercises the persistence too.

## SDK verification (pi 0.83.0, checked 31/07/2026)

Phase 3 §V, answered against the installed types rather than the docs. The
mapping table above was designed before this check; where reality differs, this
section wins.

### 1. Event names — confirmed, with one correction

`AgentSession.subscribe(listener)` delivers `AgentSessionEvent`, which is
`AgentEvent` minus `agent_end`. The union is:

```
agent_start | turn_start | turn_end | message_start | message_update |
message_end | tool_execution_start | tool_execution_update | tool_execution_end
```

Text and thinking are **not** separate top-level events. They arrive inside
`message_update`, whose `assistantMessageEvent` carries the streaming detail:

```
text_start | text_delta { delta } | text_end { content } |
thinking_start | thinking_delta { delta } | thinking_end |
tool_call | usage
```

So the adapter matches on `event.assistantMessageEvent.type`, not on the outer
event type. Tool events do sit at the top level:

| pi event                 | payload                                | AgentEvent      |
|--------------------------|----------------------------------------|-----------------|
| `tool_execution_start`   | `toolCallId`, `toolName`, `args`       | `tool start`    |
| `tool_execution_update`  | `toolCallId`, `toolName`, `partialResult` | `tool output` |
| `tool_execution_end`     | `toolCallId`, `toolName`, `result`, `isError` | `tool done`/`error` |

### 1b. What writing the adapter changed in the above

Three corrections, each found by building against the SDK rather than reading it:

- **`message_update` never carries the end of a message.** The stream switches
  to `message_end` for that, whose `AssistantMessage` holds `stopReason`
  (`stop` / `toolUse` / `error` / `aborted`) and `usage`. So the `usage` entry
  listed under `assistantMessageEvent` in §1 and §4 does not exist: an adapter
  watching only `message_update` sees every token and never learns how it went,
  or what it cost.
- **The terminal signal is simpler than `turn_end`.** `session.prompt()`
  resolves when the whole run is over -- tool loops, auto-retries and
  continuations included. The bridge awaits it and never inspects `turn_end`.
  That also settles who decides a run failed: a `message_end` with
  `stopReason: "error"` may still be followed by a successful retry pi ran on
  its own, so the verdict waits for `prompt()` to return and reads the last one.
- **Tool output arrives as cumulative snapshots, not deltas.** The bash tool
  re-sends everything the command has printed so far, throttled to 100ms. Both
  the UI and the stored record *append*, so the bridge diffs each snapshot
  against what it already forwarded and puts only the new tail on the wire.

### 2. Abort — the SDK owns it

`session.abort()` exists, and so does `session.abortBash()` for a running shell
command specifically. Also present: `abortCompaction()`, `abortBranchSummary()`,
`abortRetry()`.

**Answered, in the source and then for real: pi already kills the process
group.** The bash tool spawns with `detached: true`, so the child leads its own
group, and abort calls `killProcessTree(pid)` -- `process.kill(-pid, "SIGKILL")`,
falling back to the bare pid. Confirmed behaviourally on the test server with
`tools/live-check.ts --tools`: the model was asked to run `sleep 47`, `pgrep`
found the shell and its child, Stop was pressed, and both were gone. aw's own
process-group kill is therefore **not** needed -- spec §5's "Stop is a kill" is
satisfied by the SDK.

### 3. Custom instructions — through the resource loader, answered

`CreateAgentSessionOptions` has no system-prompt field, but
`DefaultResourceLoader` takes two: `systemPrompt` replaces pi's base prompt
and `appendSystemPrompt: string[]` extends it. Pop Agent builds its own loader per
session -- `systemPrompt` set to a short neutral Pop Agent prompt (the coding-agent
persona is not what a personal assistant should sound like) and the user's
custom instructions appended when present. The same loader construction turns
off everything a server has no use for: `noExtensions`, `noSkills`,
`noPromptTemplates`, `noThemes`, `noContextFiles` -- so no `AGENTS.md`
scavenged from the workspace can quietly join the prompt. Instructions are
fixed at session open; the bridge reopens a cached session from its JSONL when
the setting changes, the same move that survives a restart.

### 4. Usage and cost — pi reports both

`Usage` carries `input`, `output`, `cacheRead`, `cacheWrite`, optional
`reasoning`, `totalTokens`, and a `cost` breakdown with a `total`. No estimation
by character count is needed, and `llm_runs` can store real numbers. Usage
arrives on the `AssistantMessage` of a `message_end` event (see 1b), and a run
that used tools produces several -- the bridge adds them up, because every call
in a tool loop is billed. Measured on the first live run: 530 in + 29 out =
US$ 0.002265. The totals leave through the port: `run()` resolves with an
`AgentRunResult` whose usage the application books into `llm_runs`, one row
per run id -- the event stream stays exactly what the UI renders.

### 5. Model changes mid-session — supported

`session.setModel(model)` is public and async. Models come from `ModelRegistry`
/ `resolveCliModel`; the runtime that owns auth is `ModelRuntime`, which
defaults to `agentDir/auth.json` and `models.json` and can be passed in.

### 6. Tools

Built-ins are `read`, `bash`, `edit`, `write`, enabled by default. `tools` is an
allowlist, `excludeTools` a denylist applied after it, and `noTools: "all" |
"builtin"` sets the default. `customTools` registers our own (memory, notes,
web) later without touching the built-ins.

### 7. Skills — controlled by the resource loader

`loadSkills` / `loadSkillsFromDir` / `formatSkillsForPrompt` are exported, and
discovery runs through `DefaultResourceLoader`. Turning pi's own progressive
disclosure off is therefore a resource-loader decision, not a flag — which is
what the Skill Router (§8) will need in v0.2.

### 8. Binding a model to our OpenRouter key, without touching `~/.pi`

This was the open question that blocked the bridge. Verified against the
installed `ModelRuntime` types (pi 0.83.0):

```ts
const runtime = await ModelRuntime.create({
  authPath: join(dataDir, 'pi-auth.json'),   // isolated: never ~/.pi/agent/auth.json
  modelsPath: null,                          // do not read pi's models.json
  modelsStorePath: join(dataDir, 'pi-models-store.json'),
  allowModelNetwork: false,                  // no catalog fetch during boot
});

await runtime.setRuntimeApiKey('openrouter', apiKey);

const model = runtime.getModel('openrouter', 'moonshotai/kimi-k3');
// → passed to createAgentSession({ model, agentDir, sessionManager, ... })
```

Why each piece:

- **`authPath` isolated.** A stored credential outranks the environment
  variable, so pointing at pi's own auth file would let a credential Pop Agent never
  set decide which account gets billed. Pop Agent keeps its own.
- **`modelsPath: null`.** Pop Agent pins the models it offers; inheriting pi's local
  catalog would make behaviour depend on whatever the operator ran the CLI with.
- **`allowModelNetwork: false`.** Boot must not depend on OpenRouter being
  reachable. The live catalog is a Settings-screen action (`runtime.refresh()`),
  not a startup cost.
- **`agentDir` inside `POP_AGENT_DATA_DIR`.** Not in the original recipe, and it
  belongs for the same reason as the other three: `agentDir` is where pi reads
  settings, extensions and skills from, and a `~/.pi/agent` on the host must not
  get a vote on how Pop Agent behaves.

**`registerProvider` turned out to be unnecessary, and the reason is worth
recording**: this section first said the built-in `openrouter` provider "ships
with no model entries", so Pop Agent had to declare its own row with pinned pricing.
That is wrong. `pi-ai/dist/providers/data/openrouter.json` ships **303 models**,
`moonshotai/kimi-k3` among them, priced exactly as OpenRouter's live catalog
prices it: US$3/M input, US$15/M output, US$0.30/M cache read, 1,048,576
context, checked against `GET https://openrouter.ai/api/v1/models` on the same
day. With `allowModelNetwork: false`, `modelsPath: null` and an empty auth file,
`getModel('openrouter', 'moonshotai/kimi-k3')` simply resolves.

So the bridge declares nothing, and there is no second copy of the price to
drift out of date. What guards it instead is `sdk-contract.test.ts`, which
resolves that model offline in the gate: a pi release that drops the row breaks
the build rather than the first conversation of the day.

One footnote to "isolated": `ModelRuntime.create` *does* create the file at
`authPath`, empty. That is fine -- it is Pop Agent's own, inside `POP_AGENT_DATA_DIR`. The
point was isolation from `~/.pi`, not abstinence.

Verified to exist with these signatures: `ModelRuntime.create(options)`,
`setRuntimeApiKey(providerId, apiKey)` (async), `getModel(providerId, modelId)`,
`getModels(providerId)`, `registerProvider(providerId, config)`,
`refresh(options)`.

### Still open

Nothing. Every question this section tracked has an answer above: events (1),
abort (2), custom instructions (3), usage (4), model switching (5), tools (6),
skills (7), the key and the catalog (8).
