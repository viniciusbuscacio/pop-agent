# Pop Agent — pi agent integration

**Status:** normative
**Legacy coverage:** §5
**Primary implementation:** `server/src/infrastructure/agent`, `server/src/application/chat`
**Normative set:** all documents under `docs/specs/`, entered through `Spec-Pop-General.md`

> Section numbers are preserved from the former monolithic specification so
> existing code comments remain traceable. Cross-section references resolve
> through the legacy section map in `Spec-Pop-General.md`.

## 5. Purpose and boundary

Pop Agent embeds `@earendil-works/pi-coding-agent` in the server process through
its TypeScript SDK. pi is the execution engine; it is not the product boundary.
HTTP, SQLite, queues, provider election, user-facing messages and client
synchronization remain Pop Agent responsibilities.

Only infrastructure code may import the pi package. Domain, application,
interface, shared DTOs, web and CLI must remain independent of pi types. The
architecture test enforces that dependency direction.

The end-to-end supporting flow is documented in
[`docs/agent-flow.md`](../agent-flow.md). This specification is authoritative
when a supporting explanation diverges.

## 5.1 Integration layers

```text
RunService and session-command use cases
        │ application-owned ports
        ▼
PiAgentBridge
        │ Pop-owned PiEngine / PiSession abstractions
        ▼
SdkPiEngine and SdkPiSession
        │ dynamically loaded SDK
        ▼
@earendil-works/pi-coding-agent
```

Responsibilities are deliberately separated:

- `RunService` owns product orchestration: persistence, global admission,
  one-run-per-chat, Stop, stable failures, usage booking and provider failover.
- `PiAgentBridge` owns one pi session per chat, cache lifecycle, model/provider
  transitions, prompt preparation, event translation, steering, compaction
  retry, rewind and taint-guard installation.
- `SdkPiEngine` owns SDK loading, the model runtime, credentials, resource
  loading, tool construction and opening/resuming SDK sessions.
- `SdkPiSession` adapts the concrete SDK session to Pop-owned operations.
- `FakeAgentBridge` implements the same application ports for deterministic
  tests and smoke without credentials, network calls or token spend.

There are three application-facing contracts:

- `AgentBridge` for chat runs, model listing and background completions;
- `ProviderAuthBridge` for subscription login, logout and allowance data;
- `SessionCommandBridge` for compaction, stats, naming, export and forks.

Application policy must not call SDK objects around these ports.

## 5.2 Runtime package and isolation

The pi dependency must be pinned exactly in the repository manifest. A validated
runtime candidate may be activated from `POP_AGENT_DATA_DIR/pi-runtime/`; when
none is active, the bundled dependency is used. The SDK entry is imported
dynamically so the fake engine and unrelated tests do not load pi.

All pi-owned state must be rooted under Pop Agent paths:

- sessions: `POP_AGENT_DATA_DIR/sessions/`;
- agent support directory: `POP_AGENT_DATA_DIR/pi-agent/`;
- subscription credentials: `POP_AGENT_DATA_DIR/pi-auth.json`;
- model catalog cache and optional overrides: Pop-owned data paths;
- working directory: `POP_AGENT_WORKSPACE`.

Host `~/.pi` settings, credentials, extensions, skills, prompts, themes and
context files must not affect Pop Agent. The engine supplies its own
`DefaultResourceLoader`, uses in-memory pi settings and disables host resource
discovery. `allowModelNetwork` remains false during ordinary runtime creation;
boot must not depend on a live model-catalog service.

Provider/model behavior and pi runtime update policy are additionally governed
by `Spec-Pop-Providers-and-Models.md` and `Spec-Pop-Installation.md`.

## 5.3 State ownership: SQLite and JSONL

pi owns execution state in its JSONL session tree: the exact model transcript,
branches, compaction entries and model transitions. Pop Agent stores the JSONL
path in `chats.pi_session_id` but does not duplicate or interpret pi's file
format.

SQLite owns product state: chats, titles, rendered messages, queues, search,
memory, usage and user-visible system markers. Messages intentionally exist in
both stores because they serve different contracts. A pi session-format change
must not become a frontend or database migration.

Opening a chat follows these rules:

1. If SQLite has a session path, use `SessionManager.open()`.
2. Otherwise create through `SessionManager.create()` in the Pop session
   directory.
3. If the stored path is missing, log the condition and create a clean session;
   replace the pointer after pi produces the new path.
4. Do not silently replace a present but corrupt session. Corruption is an
   operational failure that must remain diagnosable.
5. Reconcile pi's session name from the SQLite chat title on every open. SQLite
   is authoritative for the product title.

Deleting a chat must dispose/forget its live pi session before removing the
associated file so no retained object can rewrite deleted execution state.

## 5.4 Model runtime and provider access

`ModelRuntime` is shared by opened sessions. API keys and custom provider
configuration are read late so Settings changes do not require a process
restart. Custom OpenAI-compatible providers are registered or refreshed before
use. The selected identity is always the provider/model pair.

A model change within the same provider uses the SDK's in-session model switch.
A provider change reopens the same JSONL through the engine so the replacement
provider receives its own credentials and registration while conversation
context survives.

`AgentBridge.complete()` is the uniform non-chat path for connection tests,
titles, summaries, transcription cleanup, skill distillation and other
background work. It has one prompt, no chat session, no tools and no history.
Reported usage must return to the application ledger just like chat usage.

Subscription OAuth remains inside `ModelRuntime`. Credentials are persisted in
Pop Agent's isolated auth store and never returned through application or HTTP
contracts. Login may expose safe interaction events and URLs, but never tokens.

## 5.5 System prompt and resources

Every opened SDK session uses Pop Agent's system prompt rather than pi's coding
assistant persona. The resource loader assembles, in order as applicable:

- permanent Pop Agent identity and product vocabulary;
- current Auto-skills policy;
- pinned trusted skills;
- owner custom instructions;
- current Files catalog;
- living user-memory document;
- recent-chat catalog wrapped as untrusted data;
- continuity information when resuming a prior JSONL session.

Per-turn routed skills and runtime notes are prepended to the user prompt rather
than permanently inserted into the system prompt. Attachments add a location
notice only for files actually saved into the workspace.

External catalogs and MCP results are data, never system authority. The
external-content envelope and taint policy are defined by
`Spec-Pop-Security.md`.

### Session-context freshness

pi fixes the resource loader and tool definitions when a session opens. The
session cache key must therefore include every mutable value captured at open,
not only the custom-instruction string. At minimum it covers:

- Auto-skills policy;
- living user memory;
- recent-chat catalog;
- enabled MCP capability catalog;
- selected local connection, machine details and current permission;
- pinned skills, custom instructions and Files catalog.

When that revision changes and the session is idle, the bridge disposes the
cached object and reopens the same JSONL before the next operation. A busy
session is never replaced underneath its run. Repository tests must prove both
refresh on revision change and reuse when the revision is stable.

## 5.6 Tool catalog

Normal Mode exposes pi's server-side built-ins (`read`, `bash`, `edit`,
`write`) plus applicable Pop custom tools:

- Notes;
- tasks catalog;
- memory and living-memory operations;
- Files search and recoverable deletion;
- skills catalog;
- explicit web fetch;
- enabled MCP capabilities;
- `local_*` tools only for the allowed attached computer associated with the
  accepted message.

The server tools always target `POP_AGENT_WORKSPACE`. Local tools are separate,
prefixed definitions backed by PLA remote operations. An unprefixed tool must
never silently change machines because a terminal connected.

Pop Agent runs normal tool calls without routine permission prompts. The
external-content taint guard remains the enforced safety floor and blocks
classified risky follow-up actions automatically. Files deletion uses Pop's
recoverable `delete_file`; destructive shell deletion inside Files is not an
acceptable substitute.

pi's own skill discovery is disabled. `skills_list` is read-only; skill
creation belongs to the reviewed background distiller, not a live tool call.

## 5.7 Plan Mode

Plan Mode is enforced behavior, not a prose suggestion. Before the turn, the
adapter calls `setActiveToolsByName()` with a fail-closed read-only catalog and
prepends the authoritative `[PLAN MODE ACTIVE]` runtime note.

Allowed tools are limited to:

- pi read-only file/navigation tools that exist in the active runtime;
- Pop's explicit read-only Notes, memory, Files, tasks, skills and web tools;
- `local_read` when an allowed local computer is attached;
- MCP tools whose standard `annotations.readOnlyHint` is exactly `true`.

Shell, write, edit, delete, unannotated MCP capabilities and unknown future
tools are absent. Returning to Normal Mode restores the catalog captured at
session open. A Plan Mode turn must investigate and end with a plan; it must
not make changes or claim proposed changes were implemented.

Execution mode is part of durable queue ordering. Steering may share a live pi
loop only when both selected local connection and execution mode match.

## 5.8 Message preparation and multimodal input

The product persists the owner's original text. Channel/runtime framing rides
only the model prompt and must not pollute product history.

Attachments are claimed under
`POP_AGENT_WORKSPACE/attachments/<chatId>/` using sanitized names and are
listed in the prompt so tools can open them. Supported image attachments are
also sent inline to a model whose catalog declares image input. For a
text-only model, the attachment remains tool-readable instead of causing an
invalid multimodal request.

Steering input receives the same attachment, skill-routing, identity and image
preparation as the initial prompt.

## 5.9 Events and translation

The infrastructure adapter translates SDK events into the small
application-owned `AgentEvent` union:

| pi SDK signal | Pop Agent event |
|---|---|
| assistant `text_delta` | `delta` |
| assistant `thinking_delta` | `thinking` |
| `tool_execution_start` | tool `start` |
| cumulative `tool_execution_update` | tool `output` containing only the new tail |
| `tool_execution_end` | tool `done` or `error` |
| accepted steering user message | `steering-delivered` |
| terminal failure | stable `error` code |

Tool output updates from pi are cumulative snapshots. The bridge must diff each
snapshot and emit only the unseen suffix because downstream stores append.

`session.prompt()` resolving is the authoritative end of the complete pi loop,
including tool calls and internal retries. The application persists the final
assistant projection and emits product-level terminal events; clients never
consume SDK event types.

Usage is collected from terminal assistant messages and summed across every
model call in a tool loop, compaction retry or other single product run. The
provider's reported token and cost values are used; the bridge must not estimate
usage from text length.

## 5.10 Concurrency, admission and durable input

Product concurrency belongs to `RunService`, not the pi adapter:

- at most one concrete run may own a chat;
- the default global execution ceiling is 20 runs;
- excess admitted runs wait in the in-memory global run queue with visible
  status rather than being refused;
- the ceiling is constructor-injectable for tests but is not currently an
  owner-facing production setting.

A message sent to a busy chat is handled by the HTTP/application queue path and
stored in the durable per-chat SQLite FIFO, up to its defensive limit. It is not
a one-slot browser queue. Compatible heads may be offered as steering;
`follow_up` items and mode/connection changes are barriers. Exact FIFO policy
belongs to `Spec-Pop-Backend.md` and the API specification.

Stopping a globally queued run removes it before engine execution and still
settles as aborted. Stopping an active run aborts the SDK session. pi must kill
the process group of an active bash child so Stop terminates work, not merely
streaming.

## 5.11 Steering

The bridge sets pi steering mode to `all`. Every accepted contiguous steering
item is queued in FIFO order before the next model call. Delivery is complete
only when pi emits the corresponding user-message event; then the bridge emits
`steering-delivered` and the application consumes the durable row.

Cancellation clears and reconstructs pi's in-memory queue from still-durable
items so order cannot drift. On run settlement, undelivered items remain in
SQLite and start as ordinary follow-up runs. Pop's durable queue remains the
authority; pi's in-memory queue is only a delivery mechanism.

## 5.12 Stop, failure, compaction and failover

The run's `AbortSignal` maps to `session.abort()`. Abort must be prompt, terminal
and safe for a caller that stopped before execution began.

Provider and SDK details are logged server-side, while the application/client
receive stable failure codes. Secrets, raw credential material and unnecessary
provider prose must not enter SSE.

When the provider refuses a turn for context overflow:

1. remember the pre-turn JSONL leaf;
2. rewind the failed attempt to that leaf;
3. invoke pi compaction;
4. retry the same prepared prompt exactly once;
5. aggregate usage across attempts and never enter an unbounded retry loop.

When a failure is eligible for provider failover, rewind to the pre-turn leaf
before the next provider is tried. A run that already produced unsafe
observable work is not silently replayed. Provider election and cooldown rules
belong to `Spec-Pop-Providers-and-Models.md`.

## 5.13 Session cache and lifecycle

The bridge caches one opened session object per chat. Busy reference counts
prevent idle disposal during runs and commands. Idle sessions are disposed
after approximately three hours and swept periodically; timers must not keep
the Node process alive.

Reopening is the normal recovery mechanism for restart, idle unload, provider
change and captured-context change. It resumes the same JSONL and is expected
to be transparent to the product conversation. There is no warm-standby pool.

`resetSessions()` disposes the cache without disabling future sweeping and is
used by the operator's LLM restart control. Shutdown disposes all sessions and
stops the sweeper.

## 5.14 Native session commands

The composer supports:

- `/compact [instructions]`;
- `/session`;
- `/name <name>`;
- `/export [html|jsonl]`;
- `/fork [number]`.

These call public SDK operations rather than prompting the model or
reimplementing pi's algorithms. Command results do not enter model context.
Session-mutating commands refuse while the chat is running or queued.

Compaction completion becomes a durable system timeline marker. Other command
output remains local to the requesting transcript. Exports are copied under
`Files/Exports/`. Naming updates SQLite and pi, with SQLite authoritative on
wake. Bare `/fork` lists user turns on the active branch; numbered fork creates
a new Pop chat backed by a branched JSONL, copies visible product history before
the selected turn and prefills that request as a draft.

## 5.15 SDK contract and runtime update gate

Every pi API Pop Agent calls must be covered by both:

1. a repository contract test against the bundled dependency; and
2. the isolated candidate probe run before a candidate can activate.

Coverage includes exports and methods used for:

- session creation, prompt, events, steering, abort and disposal;
- active-tool switching and Plan Mode;
- stats, names, exports and fork operations;
- session-tree navigation and context rebuild after rewind;
- resource loading and in-memory settings;
- server and local tool-definition factories;
- model lookup, custom registration, completions and auth;
- access to the SDK session manager and agent state required by the adapter.

The candidate probe must additionally run a token-free behavioral turn against
a loopback fake provider, execute a custom tool, return its result for the next
model call and prove abort settles an in-flight request. Version, safe ESM entry
and bundled default-model availability are mandatory checks.

A candidate that fails any contract or behavior check remains inactive. Update
failure must not damage the active runtime or normal chat path.

## 5.16 Test obligations

Changes to this integration require focused tests for the affected behavior and
the full repository gate. The maintained suite must cover at least:

- bridge/engine port isolation and architecture boundaries;
- session reuse, resume, missing file, corruption and deletion;
- instruction and context-revision invalidation;
- provider reopen and same-provider model switch;
- text, thinking, cumulative tool output, terminal errors and usage aggregation;
- Stop and child process-group termination;
- Plan Mode fail-closed activation and restoration;
- taint guard behavior;
- text and image attachments;
- steering FIFO, barriers, cancellation and settlement;
- overflow compaction/retry and failover rewind;
- session commands and export/fork behavior;
- bundled SDK contract and candidate-runtime probe;
- end-to-end HTTP/SSE smoke through the fake bridge.

No implementation change to Pop Agent's pi integration is complete until the
relevant focused tests and `npm run gate` pass.
