# Pop Agent — API contract

**Status:** normative
**Legacy coverage:** §13
**Primary implementation:** shared/src, server/src/interface/http
**Normative set:** all documents under `docs/specs/`, entered through `Spec-Pop-General.md`

> Section numbers are preserved from the former monolithic specification so
> existing code comments remain traceable. Cross-section references resolve
> through the legacy section map in `Spec-Pop-General.md`.
## 13. API contract

Everything under `/v1`. Errors always structured:
`{"error":{"code":"…","message":"…","status":401}}` with stable codes
(`invalid_credentials`, `invalid_session`, `locked`, `rate_limited`,
`chat_not_found`, `run_in_progress`, `missing_field`, `operation_error`…).

Routes: `GET /v1/auth/state`, `POST /v1/setup`, `POST /v1/login`,
`POST /v1/auth/recover`, `POST /v1/auth/change-password`,
`POST /v1/auth/sign-out-others`, `GET /v1/about`, `GET /v1/events` (single
SSE channel), `GET|POST /v1/chats`, `PATCH|DELETE /v1/chats/:id`,
`GET|POST /v1/chats/:id/messages`, `POST /v1/chats/:id/stop`,
`GET|PUT /v1/settings`, `GET /v1/models`, `GET /v1/providers`,
`PUT|DELETE /v1/providers/:id/key`, `POST /v1/providers/:id/test` (the
key is write-only: no response anywhere carries it), `GET|PUT /v1/memory`,
`GET /v1/usage` (§14), `GET /v1/backups` (§16), `GET /v1/update/status`,
`POST /v1/update/apply`, `GET /v1/ax` (§18), `GET /healthz` (no auth),
`GET /v1/health` (no auth) — the sidebar's probe: `{server, provider, db}`
with `ok|error` flags, cheap and cached only (provider = key configured +
last run's outcome, never a paid call per poll; db = a `SELECT 1`; a
user-aborted run is not a failure). No answer at all means "Server offline".
WebAuthn: `POST /v1/auth/webauthn/register`, `POST /v1/auth/webauthn/login`
(§9, v0.2).

**The SSE stream is authenticated with a one-time ticket.** `EventSource`
cannot send an Authorization header, and a session token in a query string
ends up in access logs, proxy traces and browser history. So
`POST /v1/events/ticket` (authenticated) returns a CSPRNG ticket good for
**one connection and 30 seconds**, and `GET /v1/events?ticket=…` spends it.
`POST /v1/chats/:id/messages` accepts optional
`executionMode: "normal" | "plan"` (default `normal`). The mode persists on a
queued item and is returned in its DTO; clients and rows predating 1.96 default
to normal.

A reconnect asks for a new one. The hub broadcasts every event to every valid
connection — one user, several tabs — and sends a `:ka` comment every 25s so
a proxy does not mistake an idle stream for a dead one. Tickets are bound to
the issuing session; epoch revocation or expiry closes an existing stream by
the next event or heartbeat. Backlog is bounded and overflow reconnects through
snapshot recovery. `x-pop-agent-event-version` gates additive kinds away from
cached legacy clients. Exact lifecycle, event catalog, ordering and recovery
rules live in `Spec-Pop-Events-Synchronization.md`.

`GET|PUT /v1/settings` is a **full replace**: PUT carries the whole
document and the schema is strict, so a field Pop Agent does not know is a 400
rather than something silently dropped. Public/session-establishing paths are
declared in `interface/http/route-registry.ts`. `/v1/events` is bearer-exempt
only because its one-use ticket is the complete authorization; ticket issuance
remains session-guarded. Any ordinary authenticated response may carry a
refreshed `x-pop-agent-token` (§9).

SSE events are typed in `shared/` and divided into chat lifecycle, live run,
durable queue/timeline and snapshot-invalidation events. Run events carry a
`runId`; fragments also carry monotonic `seq`, allowing the frontend to discard
stale runs and data already covered by a live snapshot. Software update state
is not part of this channel.
