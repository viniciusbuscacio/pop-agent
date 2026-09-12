# Pop Agent — API contract

**Status:** normative

`GET /v1/sync` requires an owner session and returns `{ epoch, revisions }`
with no-store caching. Its process-scoped counters identify changed resource
snapshots; a new epoch invalidates previous comparisons. Additive SSE schema 3
includes `resources-changed` with keys only, withheld from older subscribers.
`GET /v1/chats/:id/messages?attachments=metadata` returns the normal bounded
snapshot with attachment names/types and empty `dataUri` strings, including
queued attachments. Omitting the parameter retains existing full-body behavior.
See [Client synchronization](Spec-Pop-Client-Synchronization.md).

Settings PATCH accepts optional `expectedInstructions`, and Memory PUT accepts
optional `expectedDoc`. These compare-and-write preconditions return 409
`edit_conflict` when the corresponding current text differs. Comparisons and
synchronous writes occur without an intervening await. Preconditions are not
stored or echoed as settings; legacy clients may omit them. Unrelated settings
fields do not conflict with an Instructions-only precondition.
**Legacy coverage:** §13
**Primary implementation:** `shared/src/`, `server/src/interface/http/`, `web/src/services/`, `cli/src/infrastructure/api.ts`
**Related:** [`Spec-Pop-Events-Synchronization.md`](Spec-Pop-Events-Synchronization.md), [`Spec-Pop-Security.md`](Spec-Pop-Security.md), [`Spec-Pop-A2A.md`](Spec-Pop-A2A.md), [`Spec-Pop-Local-Access.md`](Spec-Pop-Local-Access.md)

## Boundary and conventions

The PWA and CLI communicate with the personal server through HTTP JSON plus one
SSE channel. They never import domain objects or pi SDK types. Stable wire DTOs
live in `@pop-agent/shared`; route adapters validate transport input and map
application outcomes.

Product APIs use `/v1`. `/healthz`, signed downloads and immutable bootstrap
artifacts are explicit exceptions. JSON uses UTF-8, camelCase fields and ISO
8601 timestamps unless a DTO says otherwise. IDs are opaque strings and must
not be parsed for meaning.

Unknown routes return JSON 404. Unsupported methods do not mutate state.
Clients must tolerate additive response fields and event kinds only when their
negotiated protocol/version allows them.

## Authentication

Ordinary guarded requests send `Authorization: Bearer <session>`. A successful
response may include `x-pop-agent-token`; clients replace the stored token
before returning the response to feature code. A 401 clears invalid local
session state and returns to login.

Public/session-establishing `/v1` paths are declared once in
`route-registry.ts`. Every other registered route is probed to require a valid
session. SSE uses a short-lived single-use session-bound ticket because native
EventSource cannot send Authorization headers. Files downloads require a current owner bearer session as well as their
path-and-expiry signature. Previously issued URLs do not bypass that guard.

Fresh guided installation adds a separate pre-account authorization boundary:
`GET /v1/onboarding/public` exposes only whether pairing or secure handoff is
required; `POST /v1/onboarding/pair` consumes the terminal code; and detailed
state, Tailscale login, and Serve HTTPS actions require
`X-Pop-Onboarding-Token`. The temporary HTTP application mounts those routes,
`/v1/auth/state`, `/v1/health`, `/healthz`, and the static setup shell only. It
does not mount `/v1/setup` or any login, recovery, product, artifact or local
access route. Ordinary deployments without pending guided state do not create
this listener.

## Error envelope

All expected API failures use:

```json
{
  "error": {
    "code": "invalid_field",
    "message": "The request has a field Pop Agent cannot accept.",
    "status": 400
  }
}
```

`code` is stable machine-readable behavior; `message` is safe owner-facing
language; `status` matches HTTP. Stack traces, SQL, credentials, provider pages
and internal paths never enter the envelope. Representative stable codes
include `invalid_session`, `invalid_credentials`, `locked`, `rate_limited`,
`missing_field`, `invalid_field`, `not_found`, entity-specific not-found codes,
`conflict`, `operation_error` and stable run/provider failure codes.

Malformed JSON maps to a body error. Strict Zod schemas reject unknown keys so
a typo or stale client cannot be silently ignored. Domain/application errors
are explicitly translated; unexpected exceptions reach centralized logging and
a generic 5xx response.

## Resource patterns

- `GET` returns an authoritative snapshot and never causes paid model work.
- `POST` creates or invokes; successful creation returns 201 and asynchronous
  admission generally returns 202.
- `PUT` is full replacement unless the route explicitly documents another
  contract. Settings PUT remains strict and complete; Settings PATCH validates
  and atomically merges only named fields for independent controls.
- `PATCH` changes named mutable fields.
- `DELETE` is idempotent only where explicitly implemented; 204 has no body.

Collections with owner-visible unbounded growth must use bounded server limits,
cursors or capped history. Query numbers are normalized to documented ranges.
The server applies a 140 MiB streaming ceiling to every `/v1` body before
parsing, large enough for a 100 MiB raw chat batch after base64 expansion, then
route-specific smaller limits before retention (100 MiB per Files upload,
25 MiB audio, and eight combined chat attachments at 25 MiB each / 100 MiB
raw total).
Missing content length is not permission for unbounded buffering.

State-changing responses return enough identity/revision data for immediate UI
projection, but the next GET remains authority. Browser services, not React
components, own fetch and DTO handling.

## Main resource groups

The registered API is organized by capability rather than one hand-maintained
flat route list:

- auth/setup/recovery/passkeys/session revocation;
- settings, server/about/health and update control;
- providers, models, OAuth, usage and credits;
- chats, messages, durable queue, Stop and session commands;
- event tickets/SSE synchronization;
- Files, trash, attachments and signed downloads;
- living memory, skills, MCP, outbound A2A agents/tasks, scheduled tasks,
  voice, storage and backups;
- PLA machines, policy, WSS and HTTPS fallback;
- public CLI/launcher/runtime/install artifacts outside guarded product state.

The concrete registry and shared DTOs are implementation authority for exact
paths. Focused specs define behavior. A2A agent configuration and persisted task
operations remain guarded, strict and bounded. Agent Card paths are bounded
same-origin relative paths. Static secrets and Microsoft Entra client secrets
are write-only; snapshots expose presence plus non-secret tenant, client and
scope metadata only. An intended path described in the A2A spec is
not delivered until its shared DTO and guarded route are registered. A proposal
route such as `/v1/ax` or an IP access-list API is not delivered merely because
it appears in historical text.

## Chat admission and queue

Posting a chat message validates attachments, execution mode and optional
stable local-machine selector before accepting product state. Text may be blank
when at least one uploaded attachment or Files reference is present; a request
with neither text nor an attachment is rejected. An idle chat persists the user
message and creates a run. A busy chat appends a durable FIFO item rather than
returning transient `run_in_progress`. The response includes stable message/run
or queue identity without waiting for model completion.

Queue edit/delete/reorder semantics, one-run-per-chat and the 1,024 defensive
pending cap are server-owned. Stop is idempotent over an active/admitted run and
settles through normal terminal synchronization. Snapshot transcript and queue
endpoints are the reconnect authority.

Archived chats accept no new message or run until restored.
`POST /v1/chats/:id/messages` returns HTTP 409 with code `chat_archived` and a
restore-first message without retaining or queueing the input. Setting
`archived: true` returns HTTP 409 with code `chat_busy` when the chat has a live
run or pending FIFO input; archive-others performs the same preflight across all
candidates and never partially archives them. Setting `archived: false` remains
allowed.

## SSE contract

The client first POSTs for a CSPRNG ticket valid for one connection and 30
seconds, then opens `GET /v1/events?ticket=…`. Tickets are spent atomically and
bound to session epoch/expiry. Streams send keepalive comments every 25 seconds
and close after revocation.

Events use schema version 2 and are typed in `shared/`. Live run fragments carry
`chatId`, `runId` and monotonic `seq`; durable invalidations cause snapshot
refetch. The hub has no replay log. Backpressure overflow closes the stream and
clients recover through snapshot reconciliation. Exact event catalog, ordering
and lifecycle are normative in the Events Synchronization specification.

Software-update state is HTTP/local PWA state, not an SSE product event.

## Files and binary responses

Uploads validate names, paths, type and size before final placement. Downloads
stream rather than buffering whole files. Active HTML/SVG content is forced to
download. `Content-Disposition` filenames are server-generated/escaped.

Files download URLs bind canonical path and expiry, require a current owner
session, and remain subject to the final filesystem jail. Backup downloads are guarded and streamed with
no-store: encrypted `.popbackup` files use application/octet-stream; legacy
`.tar.gz` files use application/gzip. GET /backups reports encrypted status and
passwordConfigured, restoreAvailable and the current operation state (without passwords). PUT /backups/password accepts a matching password and
confirmation (10–128 characters), saves through SecretsRepo and returns no
secret. POST /backups requires a configured password and never falls back to
plaintext creation. Its optional body `{ includeFiles: false }` omits the Files
tree; an empty body defaults to including it. Backup DTOs report includeFiles.
POST /backups/:name/restore accepts `{ confirm: true, password?: string }` and
returns 202 after queuing background validation on the installed systemd service.
Encrypted archives require their own password. Replacement occurs only at cold
boot, before repositories open. Unsupported hosts and concurrent operations
return 409. GET /backups lets clients recover operation state after navigation.
The offline `popman restore` command remains available.

## Local Access transport

DELETE /local-tools/machines/:id removes a known computer (204, or 404 if
unknown), cancels its local calls and closes all its transports. A persisted
revocation cutoff requires fresh sign-in before reattachment; renewed older
credentials receive 401 on HTTPS attach or close code 4001 on WebSocket attach.


PLA WebSocket upgrade authenticates the ordinary bearer session, then requires
a bounded protocol-1 attach frame. HTTPS fallback uses authenticated create,
poll and event endpoints with the same frames, leases, backpressure and replay
rules. Frames are not ordinary product DTOs and are fully defined in the Local
Access specification.

## Caching and compatibility

Authenticated mutable JSON is not treated as a public cache artifact. Public
manifest/bootstrap endpoints are `no-store`; immutable versioned artifacts may
be cached permanently only after exact release identity. The PWA service worker
must not invent API responses.

Root `VERSION`, minimum client/local-access versions and event protocol version
serve different compatibility purposes. A release bump alone does not imply a
wire break. Breaking changes require explicit minimum/version movement, shared
DTO changes, compatibility tests and migration guidance.

## Test obligations

- route inventory rejects unguarded accidental `/v1` surfaces;
- strict schemas cover missing, invalid and unknown fields;
- expected errors preserve status/code/message shape without secrets;
- snapshots and state-changing responses serialize shared DTOs;
- SSE tickets are one-use/session-bound and streams converge after reconnect;
- signed downloads reject invalid path/expiry/signature;
- body/frame/file limits and malformed encodings fail before retention;
- old supported clients are exercised whenever wire compatibility changes;
- smoke covers setup, auth, settings, frontend, chat, SSE, tools and Stop.

## REST integrations

The scoped integration server and owner-managed REST clients are specified in [Spec-Pop-REST-API.md](Spec-Pop-REST-API.md). The authenticated `/v1/rest-api/reference` exports their current inbound reference and OpenAPI.

### Small text-file editing

Owner-authenticated `GET /v1/files/text?path=<relative-path>` returns `FileTextDTO` (UTF-8 `content` and opaque `revision`). `PUT /v1/files/text` accepts `SaveFileTextRequest` (`path`, `content`, `revision`) and returns the new `FileTextDTO`. The same Files path jail applies. Supported text extensions and a 1 MiB UTF-8 byte limit are enforced server-side; empty text is allowed. A stale revision returns 409 `file_changed`, a deleted file returns 404, oversized content returns 413 and unsupported/binary text returns 415. Saves do not recreate deleted files. The revision check and write execute synchronously within the server process.

### Per-message client origin

Every user turn, including queued and steering turns, carries its own compact
client-reported origin in model context. Supported kinds include web, PWA,
Desktop, CLI, API and scheduled tasks. Platform is independent of client kind.
Missing origin is explicitly unknown; previous turns and the selected local-tool
computer must not be used to invent it. Native Desktop identifies its host before
the frontend starts. Origin metadata does not grant permissions.
