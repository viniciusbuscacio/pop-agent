# Pop Agent — REST API server and clients

**Status:** normative
**Primary implementation:** `server/src/application/integrations/`, `server/src/interface/http/integration-routes.ts`, `web/src/routes/rest-api-page.tsx`

## Purpose

Agent → REST API presents REST API Server and REST API Client as two compact cards, matching the provider settings pattern. Each card has a persisted toggle and Edit; there is no Delete action. Editing opens configuration in the same pane, with Back to the overview. Server reference and examples are collapsed by default. The shell footer, including Settings, remains available on desktop and mobile. Server accepts scoped external integrations; Clients lets Pop invoke explicitly configured public HTTPS REST operations. Neither role replaces MCP or A2A. This remains a single-owner installation.

## Reuse map

| Capability | Existing source | Integration boundary |
|---|---|---|
| Conversations and messages | ChatService / ChatRepo | Explicit read scope and DTO projection |
| Run admission | RunService.startRun | Text-only server execution, no inherited PLA |
| Busy-chat messages | QueuedMessageService | Durable follow_up delivery, no implicit steering |
| Cancellation | RunService.stopRun | Verify exact runId before invoking chat-level stop |
| Activity | SseHub domain events | Persist content-free snapshots and bounded replay |
| Provider credentials | SecretsRepo | Separate encrypted outbound client credential keys |
| Outbound network | Screened A2A transport | DNS screening/pinning, public HTTPS, no redirects |
| Scheduled tasks | Existing Tasks API | Not exposed as integration task creation in this version |

## Module switches

Owner-only GET/PATCH `/v1/rest-api/settings` reads or updates `serverEnabled` and
`clientEnabled`. Missing settings default to true to preserve existing behavior;
individual new clients still default to disabled. Partial updates preserve the
other switch. Invalid keys/types are rejected. The UI shows confirmed server
state, prevents overlapping updates and retains the previous state after errors.

Disabling Server rejects integration requests with 503 `rest_api_server_disabled`
and disconnects existing integration SSE leases within one second. Owner settings
remain accessible; tokens remain valid and admitted work continues. Disabling
Client rejects new outbound calls before network access with 503
`rest_api_client_disabled`; `rest_clients_list` returns no available operations.
Existing client configuration, enabled flags and encrypted credentials remain
stored. Already dispatched requests may complete.

## Token list presentation

Server configuration starts with a collapsed disclosure labelled `N active tokens`
(`1 active token` for a single token). Only unrevoked, unexpired tokens are counted
or rendered. Expiration updates the open screen automatically. Expanding renders
a compact table (name, permissions, expiry, last use and revocation) with Previous/Next controls and at most ten entries per page; collapsing unmounts entries. Creation and revocation
refresh the count, and pagination clamps when entries disappear. Expired/revoked
records are not exposed in this screen; no history or automatic deletion is added.

## Server credentials

Owner sessions alone manage `/v1/rest-api/tokens`, `/clients`, `/reference`, and `/health`.
Integration credentials are random 256-bit opaque `popi_` bearers. Only their SHA-256 digest is stored. A secret is shown once. Tokens expire after 7, 30 (default), or 90 days. Up to 100 active tokens may exist. Revocation does not affect owner sessions.

Tokens only enter `/v1/integration/*`. Every operation enforces its scope: `activity:read`, `conversations:read`, `conversations:write`, or `runs:cancel`. Write does not imply read. Activity alone exposes IDs, timestamps, execution state, tool name/status and coarse phase; no titles, prompts, model output, tool arguments or tool output. Read grants installation-wide personal conversation content. No scope grants account administration or local machine selection.

Rate limits: 120 requests/minute/token and three simultaneous streams/token, with 429 and Retry-After 60. Streams revalidate expiry/revocation at least once per second between writes. Slow disconnected consumers release their slot through abort cleanup. Tokens travel in Authorization headers, never URL query parameters. The owner-session UI connectivity test does not certify an external token.

## Commands and idempotency

The reference endpoint and downloadable OpenAPI enumerate the HTTP surface. Creation, sending, and cancellation require a 1–128 character Idempotency-Key (`A-Z`, `a-z`, digits, `.`, `_`, `:`, `-`). A database transaction stores request identity and response alongside synchronous admission. Repeated token/key/payload replays the original response for 24 hours, including across process reconstruction; a changed operation or payload conflicts.

Activity snapshots expose queueId when a queued message is admitted as a run, so callers can correlate the original 202 response.

Integration and REST configuration HTTP bodies are bounded at 256 KiB before parsing.

Messages contain text only, at most 32,000 characters. An active or draining run leads to a durable follow-up queue item, not steering. Current conversation execution mode and model/queue semantics remain canonical. No attachments, arbitrary settings, or PLA selector are accepted. Cancellation checks the exact run ID so a delayed request cannot stop its successor. Queue cancellation is separately identified by chat and queue ID.

## Observation

Run activity remains queryable after completion for 30 days, capped at 10,000 snapshots. Replay keeps at most 1,000 events for one hour. SSE uses bearer headers, Last-Event-ID and activity/ready/resync/heartbeat/auth-expired events. Ready or resync instructs the consumer to obtain the REST snapshot. Replay is at-least-once; clients deduplicate by cursor. Heartbeats indicate connectivity, never work progress. Quiet runs are not declared stuck. Missing runtime phase evidence is unknown.

Delegation is observable through the same aggregate delegate_worker tool status available to the PWA. It is not a fabricated per-child task scheduler. Conversation readers can retrieve completed tool details through message history. On restart, stale active snapshots become unknown unless the runtime still owns that run; live journal rows seed the new observer.

Audit records contain token ID, operation, target and timestamp, without request bodies or secrets. Audit is retained for 30 days or 10,000 rows. No telemetry leaves the installation.

## Clients

The owner configures name, HTTPS base URL, enabled state (off by default), optional Authorization or X- credential header, and 1–30 explicitly named operations. Each operation has a unique stable ID, method and static path appended to the base URL. Methods are GET/POST/PUT/PATCH/DELETE. Query parameters and JSON body are runtime inputs; arbitrary URLs, methods and headers are not.

The model uses rest_clients_list and rest_call. Listing is allowed in Plan Mode; calls are not. Calls are treated as outbound operations by the taint guard. Configuration and remote output are untrusted reference and never new user instructions. Disabled clients and unknown operations fail before network access. Settings can test an operation explicitly; the UI warns that it is a real request and writes may change remote state.

Credentials live encrypted in SecretsRepo. Metadata contains only presence. Empty UI credential input preserves the secret; explicit removal deletes it. A change of credential origin or header clears the old secret. Credentials are limited to 4,096 characters, never returned by configuration endpoints, and literal credential echoes are redacted from returned bodies.

Network policy reuses screened DNS and pinned public addresses: HTTPS only, no private/link-local/loopback destinations, no URL credentials, no redirects, fixed credential origin, 30-second request timeout, 128 KiB request and 1 MiB response limit. Returned tool content is capped at 64,000 characters. No automatic retries for writes. Private-network clients, dynamic path templates, OpenAPI import, OAuth negotiation and automatic pagination are not part of this initial client implementation.

## Validation

Cover token scope isolation, revocation/expiry, SSE cleanup, content minimization, idempotency conflicts/replay, exact cancellation identity, owner-only client configuration, fixed operations, credential replacement/redaction, and UI create/cancel behavior. Maintain shared DTOs, update the reference with contracts, and run the complete repository gate in a test-compatible environment.
