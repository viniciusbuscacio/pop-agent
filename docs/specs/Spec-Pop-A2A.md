# Pop Agent — outbound A2A client

**Status:** normative
**Scope:** independent authenticated A2A server and owner-configured outbound client
**Primary implementation:** `server/src/application/a2a/`, `server/src/infrastructure/a2a/`, `server/src/infrastructure/agent/a2a-tools.ts`
**Related:** [`Spec-Pop-Skills-and-Tools.md`](Spec-Pop-Skills-and-Tools.md), [`Spec-Pop-Security.md`](Spec-Pop-Security.md), [`Spec-Pop-API.md`](Spec-Pop-API.md), [`Spec-Pop-Backend.md`](Spec-Pop-Backend.md), [`Spec-Pop-Frontend.md`](Spec-Pop-Frontend.md)

## Product boundary

Agent → A2A has independent Server and Client modules, using the REST API screen
layout: switches, Edit (no module Delete), full-pane configuration and shared
controls. Fresh modules default OFF; an existing configured outbound client is
preserved. Turning either module off preserves its configuration.

The server publishes an authenticated A2A 1.0 Agent Card at
`/.well-known/agent-card.json` and JSON-RPC at `/a2a/rpc`, sharing the
application HTTPS listener. It uses the pinned official SDK for wire mechanics.
One independent encrypted A2A bearer key is created when enabled or configured;
rotation invalidates the old key immediately. REST keys and owner session tokens
do not authorize the A2A protocol. Server access additionally requires an allowed
source IP, defaulting to `127.0.0.1/32`, using the same trusted-proxy rules as REST.
Responses and owner key endpoints use no-store.

Incoming text tasks use the existing Pop chat/run engine. Their task and context
mapping is durable and isolated from ordinary chats: a caller cannot supply an
owner chat/run id to read or cancel unrelated work. Unique message IDs deduplicate
retries; reusing an ID with changed content is rejected. Admission is persisted
before execution. Missing admission/completion after a crash is reported honestly
as failed, never replayed automatically. Task storage is bounded at 1,000 records; terminal records older than 30 days
are pruned on admission. Deduplication and context continuation are guaranteed
while the record is retained. Stored answers do not depend on REST activity retention.
Owner-supplied context IDs must refer to a previously issued A2A context.

Server operations are SendMessage, GetTask and CancelTask. Blocking sends wait up
to 60 seconds; returnImmediately sends return the accepted task. A lost connection
or wait timeout does not claim the remote task was canceled: retry the same message
ID or inspect its task. Stop/key rotation/IP revocation prevents further access,
including an outstanding blocking wait. Existing runs remain visible to the owner.
Only text is accepted; files, artifacts, streaming, push and task lists are not
advertised. Protocol requests are bounded to 128 KiB, messages to 32,000 Unicode
characters and results to 64,000 characters. A key admits at most 120 requests/minute.

The server editor provides address, Start/Stop, key rotation/copy, Allowed IP
addresses and copyable agent instructions containing the actual card/protocol URL
and key. It does not copy REST UI-control or screenshot operations into A2A.

## Configured agents and trust

Each configured agent has a Pop-owned opaque id, owner-visible name, HTTPS base
URL, a same-origin relative Agent Card path, enabled state and optional encrypted
credential. The path defaults to `.well-known/agent-card.json`; absolute URLs,
traversal, query strings, fragments and control characters are rejected. The discovered card
and skills are cached only as bounded display/call metadata; the configured URL
and owner decision remain authority. Card changes never silently broaden Pop's
permissions or enable an agent.

“Trusted agent” means the owner chose the endpoint and credential. It does not
make remote output trusted model instructions. Agent names, descriptions,
skills, task text, status messages and errors are external content and use the
same sanitizer, explicit external-content envelope and per-turn taint path as
web and MCP results.

Credential plaintext is accepted only on create/replacement, encrypted through
Pop's secret store and never returned by APIs. Snapshots expose only credential
presence. Credentials are excluded from URLs, logs, tool output, task prose and
backups that lack `secret.key`. The MVP supports explicitly implemented static
HTTP schemes and Microsoft Entra client credentials. Entra tenant id, client id
and scope are non-secret configuration; the client secret uses the encrypted
write-only credential slot. Pop acquires short-lived access tokens server-side,
never returns or logs them, and does not execute arbitrary agent-advertised
authentication flows or arbitrary owner-supplied headers.

## Outbound network policy

Every Agent Card and protocol request uses HTTPS and a credential-free URL.
Plain HTTP, URL user-info and non-HTTPS redirects are rejected. Manual trust is
not an SSRF bypass.

Before every connection, Pop resolves and screens the destination. Public HTTPS
is allowed. Private RFC1918, Tailscale CGNAT and IPv6 ULA addresses require an
explicit Client allowed-private-destinations entry and the exact configured origin.
Loopback, link-local/cloud metadata, multicast, reserved and unspecified addresses
remain rejected even with a broad allowlist. The connection is pinned to
the screened address set so DNS rebinding cannot change the destination after
validation. Redirects are refused in the MVP; a different origin requires a
new owner configuration and policy decision. The same checks apply to the
Agent Card URL and any endpoint selected from the card.

Authorization is attached only after the final origin has passed policy and
only to the configured agent's exact allowed origin. Dynamic Entra token
acquisition occurs only after URL and DNS screening succeeds. It is never forwarded to
a card-advertised cross-origin endpoint. TLS verification remains enabled.

## Protocol runtime

Protocol mechanics use the official TypeScript `@a2a-js/sdk`, pinned exactly in
the server manifest and confined to `server/src/infrastructure/a2a/`. The MVP
speaks native A2A 1.0 through JSON-RPC or HTTP+JSON interfaces selected from the
Agent Card. It does not enable gRPC optional peers or the legacy v0.3
compatibility layer. SDK types never cross into application, HTTP DTO or PWA
contracts, and SDK upgrades are reviewed supply-chain and interoperability
changes.

## Text task lifecycle

A send creates a Pop-owned persisted task before or atomically with starting the
remote request. The task binds the configured agent, remote task/context ids
when available, the owner's outbound text, bounded latest remote text, protocol
state, timestamps and a sanitized failure category. Pop never relies on a
remote identifier as its own primary key.

MVP calls are foreground and text-only:

1. `send message` sends one bounded user text part to an enabled agent;
2. a direct remote message is persisted as a completed task result;
3. a remote task is persisted with its mapped state and can be refreshed
   explicitly;
4. `continue task` sends bounded text only when the stored task is in an
   input-required state;
5. `cancel task` asks the remote agent to cancel and persists the returned or
   locally observed outcome.

Protocol status is mapped fail-closed to Pop's finite task states. Unknown,
malformed or impossible transitions are retained as a protocol failure rather
than treated as completion. Restart retains accepted tasks, but no scheduler
resumes or polls them. The owner or a normal-mode agent turn explicitly refreshes,
continues or cancels.

Stopping a Pop chat run aborts its in-flight local wait through the run signal.
If a remote task id is already known, Pop preserves it for later inspection;
abort does not claim remote cancellation succeeded. Explicit cancellation uses
the protocol cancel operation and reports the actual result. Timeouts likewise
settle the local attempt honestly without inventing a terminal remote state.

## Deterministic limits and failures

Limits are server-owned and apply before retention or model projection:

- outbound message/continuation text: 32,000 Unicode characters;
- one foreground A2A operation: owner-configured 1–300 second hard deadline,
  defaulting to 60 seconds and also abortable by the active run signal;
- one HTTP response body: 1 MiB before parsing;
- text projected from one result into a model turn: 64,000 characters;
- task/API collections: newest-first and capped at 100 in the MVP;
- no redirects, artifact bytes, background queue or unbounded protocol history.

The application service owns state transitions and persistence. The protocol
adapter owns SDK/wire translation, SSRF-safe transport, body/time limits and
cancellation cleanup. Expected failures map to bounded stable categories such
as agent/task not found, disabled agent, invalid state, timeout, cancellation,
transport, authentication, response-too-large and protocol error. Raw remote
bodies, credentials, stack traces and internal paths do not cross into tools or
HTTP errors.

## Pi tools and execution policy

Pop projects exactly five A2A tools into a pi session when the A2A service is
composed:

- `a2a_agents_list()` lists enabled configured peers and bounded card metadata;
- `a2a_send_message(agentId, message)` starts a foreground text task;
- `a2a_get_task(taskId)` explicitly refreshes a persisted task;
- `a2a_cancel_task(taskId)` requests remote cancellation;
- `a2a_continue_task(taskId, message)` responds to an input-required task.

Their schemas are closed and length-bounded. Every operation receives the run's
AbortSignal. Every successful remote result, remote failure message and cached
remote metadata result is sanitized, bounded and wrapped in a source-labelled
external-content envelope before pi receives it.

All five tools are **Normal Mode only**. Even list/get are absent in Plan Mode;
A2A metadata has no advisory read-only escape comparable to MCP annotations.
The Plan Mode catalogue is an explicit allowlist and must never gain an A2A tool
by wildcard or registration side effect.

Once A2A output taints a turn, deterministic taint policy blocks the mutating
A2A tools (`a2a_send_message`, `a2a_continue_task`, `a2a_cancel_task`) in that
turn. Listing and refreshing may continue, but cannot make remote text trusted.
A fresh owner-authored turn may perform the requested mutation.

`buildA2aTools` is the narrow pi projection boundary. Until the application
service and durable composition land together, `SdkPiEngine` may expose only an
optional A2A tool factory and `main.ts` must leave it unset. Shipping a visible
or callable A2A surface requires composing the real application service,
persistence and SSRF-safe adapter; an in-memory or partially wired fallback is
forbidden.

## Owner API and UI

The authenticated product API owns guarded A2A agent configuration and bounded
task snapshots. Its intended resource shape is `/v1/a2a/agents` for list/create,
`/v1/a2a/agents/:agentId` for read/replace/delete, an explicit connection test,
and `/v1/a2a/tasks` plus task-specific refresh/cancel/continue commands. Exact
paths ship only with strict shared DTOs and guarded route registration; this
specification does not make an unimplemented route available.

The PWA destination is **Agent → A2A**, immediately beside MCP in the Agent
segmented navigation. Its editor exposes the relative Agent Card path and, for
Microsoft Entra, tenant id, client id, scope and write-only client secret. A
Microsoft Foundry preset selects `agentCard/v1.0`, JSON-RPC-compatible Entra
configuration and `https://ai.azure.com/.default` without replacing the owner’s
name or base URL. It uses route/full-pane list and editor flows, never a form
side drawer. Create/edit Save always has Cancel. The UI shows enabled state,
HTTPS endpoint, credential-present state, last bounded connection/card status,
skills and persisted foreground tasks without rendering raw HTML. Deleting a
configuration requires explicit blast-radius wording for retained task history.

Frontend services remain the only HTTP door. Components do not perform card
fetches, protocol calls or SSRF decisions, and browser state is never A2A task
authority.

## Test obligations

Focused tests must cover:

- HTTPS/public-address validation, IPv4/IPv6 private ranges, DNS rebinding
  resistance, redirect refusal, origin-bound authorization and response limits;
- encrypted credential write/replacement/redaction and no-secret errors/logs;
- text-only protocol mapping, persistence before accepted work, restart-visible
  tasks, input-required continuation, cancellation, timeout and run abort;
- typed/bounded tool schemas and exact five-name catalogue;
- an external-content envelope on every A2A tool result, including malicious
  card/task text and bounded failures;
- explicit exclusion of every A2A tool from Plan Mode;
- taint caused by A2A output and refusal of later mutating A2A calls;
- guarded strict API contracts and service-only frontend network access when
  those slices land.

The complete gate is required before the composed feature ships.

## Message authorship

Outbound task requests persist an author per message: owner (direct UI send),
agent (Pop tool invocation), or unknown (legacy/unattributed). Continuations
preserve previous authors rather than overwriting history. The UI labels these
You → remote agent and Pop → remote agent; remote responses are identified
separately. Tool schemas do not let the model impersonate the owner.

Pop sends this informational origin in message metadata. Receiving peers may
report owner/agent origin, but it is not an authenticated human identity and
never grants extra authority. Incoming chats are titled A2A and their messages
display Remote user → Pop, Remote agent → Pop or A2A peer → Pop; metadata is
marked as reported by the authenticated peer. Unknown history stays unknown.
The message DTO carries only this finite label, never bearer keys or source IPs.
