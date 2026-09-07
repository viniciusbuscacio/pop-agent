# Pop Agent — REST API server and clients

**Status:** normative
**Primary implementation:** `server/src/application/integrations/`, `server/src/interface/http/integration-routes.ts`, `web/src/routes/rest-api-page.tsx`

## Purpose

Agent → REST API presents REST API Server and REST API Client as two compact cards, matching the provider settings pattern. Each card has a persisted toggle and Edit; there is no Delete action. Editing opens configuration in the same pane, with Back to the overview. Detailed server reference and extended examples are collapsed by default; a concise Agent instructions block remains visible and copyable. The shell footer, including Settings, remains available on desktop and mobile. Server accepts external integrations through one owner-managed access key; Clients lets Pop invoke explicitly configured public HTTPS REST operations. Neither role replaces MCP or A2A. This remains a single-owner installation.

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

## Single access key

Pop Agent is single-owner. Server settings expose one Access key, Copy key and Generate key / Generate new key. There is no token list, pagination, name, expiry or permission form. Agent instructions include the actual current key and copy as a ready-to-paste block. Loading the screen does not generate or rotate credentials; the key is recovered on reopening, and copy is disabled until a key is available. Replacing the key immediately updates the instructions. A failed/lost rotation response triggers one read-back, never automatic rotation retries.

Owner-only GET `/v1/rest-api/key` returns `{secret: string | null}`; POST generates/replaces it and returns the new secret. Both responses use `Cache-Control: no-store`. A key is a random 256-bit opaque `popi_` bearer. Its SHA-256 digest is used for authentication; its recoverable value is stored encrypted through SecretsRepo, never in plain settings, logs or browser persistence. It has no automatic expiry (the existing numeric metadata uses the maximum JavaScript date). Only owner sessions may read or replace the key, including while Server is disabled.

Rotation atomically revokes every existing token, inserts the new authentication digest and saves its encrypted value in the same SQLite transaction. Persistence failure retains the previous key. The new key grants all five REST scopes internally: activity, conversation read/write, cancellation and UI control. No per-key permission selector is shown. Existing scoped tokens remain usable until the owner generates the single key; they are not silently upgraded. The old POST `/v1/rest-api/tokens` returns 410 `single_api_key`; legacy metadata GET and DELETE remain for migration, but are absent from the product UI. Once a singleton exists, legacy scoped issuance is also rejected internally.

The key only enters `/v1/integration/*`; direct owner administration remains separate. UI control may perform owner actions through a signed-in tab, including settings and local-machine selection. Activity projections remain content-free; conversation endpoints expose personal content. The server switch gates all integration operations.

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

Configuration forms explicitly mark non-submit actions as `type="button"`: adding/removing operations, cancelling, testing, copying and revoking must never implicitly submit a form. Only Save/Create token/Send request submit their corresponding forms.

## Live UI control

Like the go-notepad/go-apiserver bridge, operations act on the real browser DOM and return state after rendering and up to three seconds of API-request settling. `pendingRequests` reports unfinished API calls; streaming runs, native dialogs, uploads and OS interactions are not claimed complete by this marker. No browser engine, screenshot renderer or system package is installed.

Signed-in tabs register automatically while REST API Server is enabled, with a platform/browser label. The REST Server switch is the sole UI-access switch; no tab-name field, Connect/Disconnect action or separate Stop UI control is shown. Authenticated per-tab DELETE cleanup remains available while the module is disabled, so toggling cannot leave stale registrations. Turning the switch off stops UI access and screen sharing; sign-out and app teardown also disconnect. Registration is retried every five seconds after transport loss, without replaying commands. Connection IDs are mandatory for every command; multiple tabs are never selected implicitly. The owner-only transport registers, polls and acknowledges using a per-tab capability header. Capabilities are never returned by the public session list. Closing, signing out, disconnecting, or 45 seconds without polling expires access. Eight sessions maximum, one command in flight per session; concurrent calls return `ui_busy`. Commands are delivered once, expire after eight seconds, and a timeout removes the session. Never retry writes automatically: their outcome may be unknown.

`GET /v1/integration/ax` discovers the contract; `/v1/ax` is its owner-session equivalent. UI-scoped integration tokens use `/v1/integration/ui/sessions`, `/state?sessionId=...`, `/screenshot?sessionId=...`, and POST `/press`, `/dblclick`, `/input`, `/key`. Owner sessions use `/v1/ui/*`. UI access checks the module switch, token scope and rate limit, rechecks authorization before command delivery and before returning results. The single key includes UI control, which grants owner actions and screen contents. Legacy scoped tokens still require `ui:control`. Native text state excludes password values and elements marked `data-ui-private`. Screenshots are raw user-authorized captures and may contain visible secrets.

State lists visible controls with testid, index, role, name and disabled state. Repeated IDs require an explicit index. Empty input clears a supported text/select field. Missing, ambiguous and disabled targets fail explicitly. Keyboard events invoke application handlers, not trusted browser/OS shortcuts. Native dialogs/file pickers require the user. The bridge does not execute arbitrary JavaScript.

Screenshots require an independent user gesture and browser `getDisplayMedia` consent. The captured surface is exactly the tab/window/screen selected by the user; it is not a synthetic DOM reconstruction. PNGs scale to at most 1920 pixels wide and 3.5 MB base64. The transport caps replies at 4 MiB. No captures or screen contents are persisted or logged. Sharing ends with track stop, disconnect or page close; unsupported browsers return a clear message. JSON discovery remains available without screen sharing. The settings UI no longer exposes a sharing action; automatic capture requires a separate browser integration and is not implied by enabling the REST server.

The Server editor follows the go-notepad layout with Start/Stop, persisted enabled-state status, address, connection port, HTTPS and access-control cards, Agent instructions and a single Access key. No separate UI-access or screenshot-sharing panel is shown. Port/HTTPS describe the current app origin; this screen does not change the shared listener, TLS or tailnet policy. No independent API autostart switch is shown: the existing enabled state persists across restarts. Copy instructions is disabled until a key is available, then includes the current persistent key and supported operations. Detailed reference remains collapsed.
