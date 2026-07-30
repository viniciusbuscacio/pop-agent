# Agent flow — frontend ↔ pi SDK, end to end

Design detail for popy.spec §5, §13, §14. The spec stays normative; this
document explains how a message travels through every layer and what each
layer maps. Update it when the flow changes.

**The frontend never touches the pi SDK.** Its entire contract is DTOs
(`@popy/shared`) over HTTP + SSE. The pi SDK lives behind two boundaries:
the `AgentBridge` port (application) and its adapter (infrastructure).

## The wire (what web sees)

```
web                        server
 │  POST /v1/chats/:id/messages          SendMessageRequest DTO
 │ ────────────────────────────────────▶ { text, attachments? }
 │  202 Accepted                         SendMessageResponse DTO
 │ ◀──────────────────────────────────── { runId, userMessageId }
 │
 │  GET /v1/events (EventSource, one per app instance)
 │ ◀━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ StreamEvent DTOs, one per SSE frame
 │    delta → thinking → tool(start|output|done) → … → done
```

- Send is **fire-and-return**: the POST enqueues the run and answers
  immediately; everything streamed comes through the single SSE channel.
- Every event carries `chatId` + `runId`. The frontend keeps a **runId
  registry**: events for unknown/stale runs are dropped (no cross-chat
  leaks, no zombie deltas after Stop).
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
  `@popy/shared` so web imports the exact same types.
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
  chat uses `SessionManager.create(POPY_WORKSPACE, POPY_DATA_DIR/sessions)`
  and records the path.
- **Concurrency**: semaphore, default 20 (setting). Acquire before
  `prompt`, release on terminal event; queued runs emit a queued status.
- **Abort**: `signal` from the use case → abort the pi run AND kill the
  process group of any running bash child (aw has a reference
  implementation; verify pi's own abort behavior — spec §20 list).
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
- **Reload / reconnect reconciliation**: on mount or SSE reconnect,
  refetch `GET /v1/chats/:id/messages` and merge with the live buffer by
  `runId`/`messageId` — never duplicate a message that both paths deliver
  (aw's streaming machine, spec §14).
- Send path: optimistic append of the user message, then POST; on
  `run_in_progress`/cap errors show the queued chip (spec §14).

## Failure modes (design targets)

| Failure                       | Behavior                                        |
|-------------------------------|-------------------------------------------------|
| SSE drops mid-run             | client reconnects + refetches; run unaffected   |
| server restarts mid-run       | run dies; chat shows last persisted state; user resends |
| pi throws inside a run        | `error` event with stable code; user message already persisted |
| provider auth/limit error     | `error` code surfaces the provider code; no retry loops |
| Stop pressed                  | abort + child process-group kill; terminal `error/aborted` |

## v0.1 build order for this flow

1. `AgentBridge` port + fake adapter (scripted events) → wire the full
   path with zero tokens; smoke test asserts the SSE sequence.
2. `PiAgentBridge` with `SessionManager.inMemory()` + real OpenRouter key
   behind `.env` (manual test).
3. Persistent sessions (`sessionDir`, `pi_session_id`) + SQLite repo.
4. Frontend chat store + streaming UI against the fake adapter first.
