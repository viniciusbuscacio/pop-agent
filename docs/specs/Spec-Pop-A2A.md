# Pop Agent — outbound A2A client

**Status:** normative
**Scope:** client-only MVP for owner-configured Agent2Agent (A2A) peers
**Primary implementation:** `server/src/application/a2a/`, `server/src/infrastructure/a2a/`, `server/src/infrastructure/agent/a2a-tools.ts`
**Related:** [`Spec-Pop-Skills-and-Tools.md`](Spec-Pop-Skills-and-Tools.md), [`Spec-Pop-Security.md`](Spec-Pop-Security.md), [`Spec-Pop-API.md`](Spec-Pop-API.md), [`Spec-Pop-Backend.md`](Spec-Pop-Backend.md), [`Spec-Pop-Frontend.md`](Spec-Pop-Frontend.md)

## Product boundary

The A2A MVP lets the owner configure a small set of trusted remote agents and
lets Pop Agent send them foreground text tasks. Pop is an A2A **client only**.
It does not publish an Agent Card, accept A2A requests, expose an A2A server or
make the owner's agent reachable by other agents.

Configuration is manual and authenticated. Discovery from a public directory,
automatic trust, peer-to-peer enrollment and importing configuration from the
host are out of scope. Calling an enabled configured agent is a user-requested
integration, not telemetry or ambient network activity.

The following are also out of scope for the MVP:

- file or binary parts, URLs treated as attachments, and artifact transfer;
- structured/data parts beyond protocol identifiers and status metadata;
- streaming responses, push notifications, webhooks and push-notification
  configuration;
- schedules, autonomous polling, background continuation or unsolicited work;
- multi-agent routing, delegation graphs and public agent discovery.

A remote response containing an artifact or unsupported part is not downloaded,
opened, written to Files or silently flattened into model context. Pop records a
bounded unsupported-content result and keeps the task inspectable.

## Configured agents and trust

Each configured agent has a Pop-owned opaque id, owner-visible name, HTTPS base
URL for Agent Card discovery, enabled state and optional encrypted credential. The discovered card
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
backups that lack `secret.key`. The MVP supports only explicitly implemented
static HTTP authentication schemes; it does not execute arbitrary
agent-advertised authentication flows or arbitrary owner-supplied headers.

## Outbound network policy

Every Agent Card and protocol request uses HTTPS and a credential-free URL.
Plain HTTP, URL user-info and non-HTTPS redirects are rejected. Manual trust is
not an SSRF bypass.

Before every connection, Pop resolves the destination and rejects loopback,
private, link-local, carrier-grade NAT, multicast, reserved, unspecified and
cloud-metadata addresses for both IPv4 and IPv6. The connection is pinned to
the screened address set so DNS rebinding cannot change the destination after
validation. Redirects are refused in the MVP; a different origin requires a
new owner configuration and policy decision. The same checks apply to the
Agent Card URL and any endpoint selected from the card.

Authorization is attached only after the final origin has passed policy and
only to the configured agent's exact allowed origin. It is never forwarded to
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
segmented navigation. It uses route/full-pane list and editor flows, never a form
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
