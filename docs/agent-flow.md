# Agent flow — client to pi SDK and back

This is the implementation guide for the normative pi integration in
[`docs/specs/Spec-Pop-Pi-Agent-Integration.md`](specs/Spec-Pop-Pi-Agent-Integration.md).
It explains the current path of a chat message. The focused specification is
authoritative when this supporting document diverges.

The frontend and CLI never import or address pi. Their contracts are shared
HTTP and SSE DTOs. pi exists only in server infrastructure behind
application-owned ports.

## 1. End-to-end map

```text
PWA / CLI
   │ POST message, queue edit, Stop, session command
   ▼
interface/http
   │ validate DTO and map transport result
   ▼
application/chat
   │ persist product state, admit/queue run, choose provider chain
   │
   │ AgentBridge / ProviderAuthBridge / SessionCommandBridge
   ▼
infrastructure/agent/PiAgentBridge
   │ prepare prompt, acquire session, translate events, guard and rewind
   │
   │ PiEngine / PiSession
   ▼
infrastructure/agent/SdkPiEngine + SdkPiSession
   │ dynamic SDK call
   ▼
@earendil-works/pi-coding-agent
   │ provider requests and tool execution
   ▼
PiAgentBridge → RunService → SQLite + EventSink → SSE → every client
```

`FakeAgentBridge` can replace the concrete adapter at the same application
boundary. Smoke tests therefore cover HTTP, persistence and SSE without loading
the SDK or spending tokens.

## 2. Sending and queuing

The ordinary wire begins with:

```text
POST /v1/chats/:chatId/messages
{ text, attachments?, delivery?, executionMode? }
```

For an idle chat, the application:

1. validates that the chat exists and the server accepts LLM work;
2. persists the original user message in SQLite;
3. allocates a run id and broadcasts `run-started` with that persisted message;
4. executes immediately when below the global ceiling or enters the visible
   in-memory admission queue;
5. returns the accepted run and message identity without waiting for the model.

Only one concrete run owns a chat. A second message received through HTTP while
that chat is occupied is atomically appended to the per-chat SQLite FIFO rather
than exposed as a transient `run_in_progress` failure. The FIFO holds up to
1,024 pending inputs per chat.

The default delivery mode may offer a compatible queue head to the live pi loop
as steering. `/queue <message>` sets `follow_up`, which is a FIFO barrier and
waits for run settlement. Execution-mode or selected-local-connection changes
are barriers too. Queue items may be edited or deleted by id, and every change
is synchronized across clients.

The global execution ceiling defaults to 20. Runs for different chats above the
ceiling wait in `RunService` and emit queued status; this admission queue is
distinct from a busy chat's durable message FIFO.

## 3. Application orchestration

`RunService` owns product behavior and knows only `AgentBridge`:

- one run per chat and the global ceiling;
- durable user-message and assistant-message projection;
- run status and stable failure codes;
- AbortController lifecycle;
- provider failover and cooldown integration;
- usage booking;
- notifications, indexing and provenance hooks;
- offering and settling durable steering items.

It passes an `AgentRunRequest` containing the chat, provider/model pair, prompt,
attachments, execution mode, optional local-connection identity, callbacks and
abort signal. Once the bridge exposes `AgentRunControl`, the queue service can
offer, cancel or rebuild steering for that exact run.

The application is transport-blind and SDK-blind. Domain objects do not cross
the interface boundary; route and SSE adapters map them to DTOs from
`@pop-agent/shared`.

## 4. Acquiring a pi session

`PiAgentBridge` maintains one cached `PiSession` per chat. On every operation it
resolves the effective provider/model pair and reads the current session-open
context revision.

A cached session is reopened from its JSONL when any captured input changed:

- owner/pinned/Files instructions;
- Auto-skills policy, living memory or recent-chat catalog;
- enabled MCP capability catalog;
- selected local connection, machine details or permission;
- provider identity.

A model change inside the same provider uses `setModel()` in place. A busy
session is never disposed by revision refresh or the idle sweeper. Idle entries
are disposed after approximately three hours; shutdown, chat deletion and the
operator's LLM restart also clear applicable entries.

If SQLite holds `pi_session_id`, the engine resumes with
`SessionManager.open()`. Otherwise it creates under
`POP_AGENT_DATA_DIR/sessions/`. A missing stored path starts clean and is
replaced after pi assigns a new file; other open failures remain visible.

SQLite owns the chat title. Each SDK open synchronizes pi's session name from
that title.

## 5. Opening the SDK runtime

`SdkPiEngine` dynamically imports either the validated active runtime entry or
the repository-pinned package. It creates an isolated `ModelRuntime` with
Pop-owned auth/catalog paths and no ordinary model-catalog network fetch.

Before opening a session it:

1. applies the current key or subscription credential;
2. registers current custom provider definitions when needed;
3. resolves the exact model;
4. creates or opens the pi `SessionManager`;
5. builds Pop's `DefaultResourceLoader` with host discovery disabled;
6. builds Pop custom tools, enabled MCP tools and applicable `local_*` tools;
7. creates in-memory pi settings for compaction and steering;
8. calls `createAgentSession()` and wraps the result in `SdkPiSession`.

The resource loader replaces pi's coding-agent persona. It appends Pop's
captured instructions, user memory, the untrusted recent-chat catalog and a
continuity note for resumed sessions. Pinned skills and Files catalog arrive in
the instruction block assembled by the composition root. Per-turn routed
skills remain part of that turn's prompt.

## 6. Prompt and attachment preparation

Before calling pi, the bridge:

1. writes accepted attachments under
   `POP_AGENT_WORKSPACE/attachments/<chatId>/` with sanitized names;
2. adds their relative paths to the model prompt;
3. prepends relevant routed skills;
4. adds the runtime/client identity note when required;
5. extracts valid image data for a model that declares image input.

SQLite retains the owner's original message. Prompt-only framing is not written
back into product history.

Steering input goes through the same preparation pipeline. A text-only model
receives attachment paths but no unsupported inline image payload.

## 7. Tools, execution mode and guard

Normal Mode restores the tool names captured when the SDK session opened:
server `read`, `bash`, `edit`, `write`, Pop tools, enabled MCP capabilities and
allowed local tools.

Plan Mode calls `setActiveToolsByName()` with the fail-closed read-only list.
Only MCP tools explicitly annotated with `readOnlyHint: true` enter it. The
runtime prompt also receives `[PLAN MODE ACTIVE]`; the active catalog, not model
compliance alone, prevents writes.

For every run the bridge installs a `TaintGuard` through a small Pop-owned pi
extension. Tool results feed the turn's taint state. Before later tool calls,
the guard automatically blocks classified exfiltration, secret access or
irreversible action. The guard is removed in `finally` so state cannot leak to
the next run.

Server tools always mean the server workspace. `local_*` definitions are pi's
same tool schemas backed by PLA operations for the selected allowed computer.
If no allowed local connection was associated with the message, those tools are
absent.

## 8. SDK events to product events

`AgentSession.subscribe()` emits pi events. The bridge maps only the information
the application needs:

| SDK event | Bridge action |
|---|---|
| `message_update` / `text_delta` | emit `delta` |
| `message_update` / `thinking_delta` | emit `thinking` |
| `tool_execution_start` | emit tool `start` with call detail |
| `tool_execution_update` | diff cumulative output and emit only its new tail |
| `tool_execution_end` | emit tool `done` or `error` |
| steering `message_start` with matching user text | emit `steering-delivered` |
| assistant `message_end` | collect usage and last failure state |

pi tool updates are cumulative snapshots. Forwarding each snapshot whole would
duplicate output because clients and persistence append; `RunTranslator` tracks
the prior snapshot per tool call.

`session.prompt()` resolving ends the complete engine loop, including tools and
SDK-internal continuation. The bridge then emits the final application outcome;
`RunService` persists the assembled assistant projection and sends product SSE
events.

A run may contain several provider calls. Usage from every assistant terminal
message is added before one product `llm_runs` entry is booked.

## 9. Steering lifecycle

The bridge forces pi steering mode to `all`. Queue-service offers are serialized
and passed to `session.steer()` in FIFO order. Acceptance into pi's in-memory
queue does not consume SQLite.

When pi emits the matching user-message start, the bridge reports
`steering-delivered`. The application then:

- persists the completed assistant segment before it;
- persists the steering user message;
- removes that durable queue item;
- resets the current live assistant buffer while retaining the run id;
- offers the next compatible FIFO head.

Cancellation clears pi's queue and reconstructs it from still-valid durable
items. Undelivered input remains in SQLite after run settlement and starts as a
normal follow-up. This keeps SQLite, not pi RAM, authoritative.

## 10. Stop, overflow and failover

Stop aborts the run's `AbortController`; the bridge calls `session.abort()`.
The SDK's bash implementation terminates the child process group, so work and
streaming stop together. A run waiting in the global admission queue is removed
without opening an engine and still settles as aborted.

Before prompting, the bridge records the current JSONL leaf. On context
overflow it:

1. rewinds the rejected turn to that leaf;
2. unsubscribes the first translator;
3. asks pi to compact;
4. subscribes a fresh translator carrying prior usage;
5. retries the identical prepared turn once.

A second failure is terminal. There is no unbounded compaction loop.

For a failover-eligible refusal, the bridge also rewinds before returning to
`RunService`. The next provider opens the same clean JSONL branch, preventing
the owner's question from appearing twice. Product policy decides whether an
attempt is safe to replay and which provider is next.

## 11. Session commands and background completions

`SessionCommandBridge` adapts pi's public operations for compact, stats, name,
HTML/JSONL export and branch/fork. Commands acquire an idle session and refuse
to mutate one in use. Product services decide which results become timeline
markers or Files exports.

`AgentBridge.complete()` uses `ModelRuntime.completeSimple()` without a chat
session, history or tools. It is the common path for service work and returns
provider-reported usage when available.

`ProviderAuthBridge` delegates OAuth and subscription allowance operations to
the isolated model runtime. Credential material stays below the port.

## 12. Client projection and reconciliation

The PWA owns one EventSource in `web/src/services/events.ts`. It batches
high-volume stream fragments for rendering but flushes lifecycle events
immediately. Stores keep persisted messages plus a live projection keyed by
`chatId` and `runId`; stale fragments from replaced runs are ignored.

On boot or SSE reconnect, the frontend refetches the server transcript and full
pending FIFO. The server snapshot is authoritative; SSE supplies low-latency
increments. A steering-delivery boundary settles one assistant segment and
starts another within the same run.

Run status, not tool-card state, drives queued/running presentation. Stop and
terminal events clear it. Detailed synchronization rules live in
`Spec-Pop-Events-Synchronization.md` and frontend behavior in
`Spec-Pop-Frontend.md`.

## 13. Failure behavior

| Failure | Required result |
|---|---|
| SSE disconnects | run continues; reconnect plus snapshot converges |
| tab/PWA closes | server run and durable FIFO continue |
| server restarts mid-run | partial product run is interrupted; pending FIFO survives |
| pi session path is missing | log and create a replacement session |
| pi session is corrupt | expose an operational failure; do not silently erase it |
| provider rejects before unsafe work | stable error or eligible clean failover |
| context overflow | compact and retry once from the pre-turn leaf |
| Stop is pressed | abort engine and process group; settle terminally |
| local permission changes | next operation reopens without stale local tools |
| candidate SDK breaks a required API | candidate remains inactive |

Provider details useful to operators go to server logs. SSE carries stable codes
and product-safe state, never credentials.

## 14. Contract protection

`server/src/infrastructure/agent/sdk-contract.test.ts` verifies every bundled SDK
surface used by the adapter. The candidate probe repeats that runtime contract
against the isolated candidate and performs an offline loopback behavior check:
custom tool call, tool-result continuation and in-flight abort.

The contract includes AgentSession tool/mode/session-command APIs,
SessionManager tree APIs, resource/settings loaders, local tool factories and
ModelRuntime model/auth/completion APIs. Adding a new SDK call requires adding
it to both checks in the same change.

Focused bridge/engine tests cover event mapping, cache invalidation, steering,
rewind, Plan Mode, attachments, usage and safety. The repository gate then runs
architecture checks, all tests, builds and end-to-end fake-provider smoke.
