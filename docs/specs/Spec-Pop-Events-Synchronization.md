# Pop Agent — real-time event synchronization

**Status:** normative
**Primary implementation:** `server/src/application/ports/event-sink.ts`, `server/src/interface/http/sse-hub.ts`, `server/src/interface/http/event-tickets.ts`, `web/src/services/events.ts`
**Related:** [`Spec-Pop-API.md`](Spec-Pop-API.md), [`Spec-Pop-Frontend.md`](Spec-Pop-Frontend.md), [`Spec-Pop-Local-Access.md`](Spec-Pop-Local-Access.md), [`../agent-flow.md`](../agent-flow.md)

## Purpose and scope

Pop Agent has one session-wide Server-Sent Events channel for low-latency
server-to-browser delivery. It carries live run output and changes to product
state displayed by the web app. It is not the PWA service-worker update channel
and does not install server, pi, CLI or PWA software.

```text
server ── SSE ──▶ signed-in web app / installed PWA
   ▲                         │
   └──────── HTTP ───────────┘

server ◀──────── PLA ───────▶ selected local computer
```

The protocol roles are distinct:

- HTTP accepts browser actions and returns authoritative snapshots/results;
- SSE pushes server changes and run fragments to browser clients;
- PLA connects the server with optional tray/CLI local-computer runtimes;
- service-worker and deployment mechanisms update software independently.

SSE is an ephemeral notification/streaming transport. SQLite and other product
stores remain authoritative; the hub is neither persistence nor an audit log.

## Ownership and architecture

Application services publish the application-owned `RunEvent` union through
`EventSink`. Infrastructure/composition callbacks use the same union for state
that originates at an adapter boundary, such as a PLA connection transition.

`SseHub` is the interface adapter. It:

1. explicitly maps every `RunEvent` to the shared `StreamEvent` DTO;
2. serializes the DTO as JSON;
3. broadcasts the payload to every current subscriber.

The authoritative wire union lives in `shared/src/index.ts`; web code imports it
rather than redefining server events. Adding an event requires coordinated
application event, hub mapping, shared DTO, consumer and test changes. A wire
event with no producer or policy must not remain in the union as speculative
roadmap.

Pop Agent is single-user, so there is no per-account event partition. Every
valid connected tab/device receives the same product stream and consumers
filter by event kind, chat and run. This broadcast rule does not weaken session
authentication or revocation.

## Browser connection lifecycle

`web/src/services/events.ts` owns the only EventSource for one signed-in browser
app instance. Components and stores subscribe to this service; they must never
open their own EventSource.

`Boot` starts it when authentication state becomes `signed-in` and stops it when
that authenticated app lifetime ends. Because Boot exists above application
routes, the stream stays active in chat, Files, explorers and Settings.

`start()` and connection creation must be idempotent even while ticket issuance
is in flight. A generation identifies each attempt so:

- repeated starts cannot create duplicate EventSources;
- a ticket response from before stop/restart is ignored;
- foreground replacement invalidates the old pending attempt;
- errors from a superseded EventSource cannot clear or retry the current one.

Stopping clears retry timers, closes the current source, invalidates pending
tickets, drops buffered fragments and unregisters browser-lifecycle listeners.

## Ticket authentication

Native EventSource cannot set Pop Agent's bearer header. Connection therefore
uses two hops:

1. authenticated `POST /v1/events/ticket`;
2. public-by-declaration `GET /v1/events?ticket=<ticket>`.

The GET is exempt from the bearer middleware only because the ticket is its
complete authorization. It must reject absent, invented, expired and already
spent tickets.

A ticket:

- contains 256 bits from `node:crypto` CSPRNG, encoded as base64url;
- expires 30 seconds after issuance;
- can establish at most one stream;
- is not the bearer token;
- is bound server-side to the authenticated session payload that requested it;
- captures the client's declared additive event-schema version;
- is held only in process memory and may disappear on restart.

Current web/CLI clients send `x-pop-agent-event-version`; absence means legacy
version 1. The server clamps declarations to the latest schema it implements.
This value grants no authority: it only prevents a cached older web bundle from
receiving a newly added event kind that its exhaustive handler does not know.

The bearer token never enters URLs, browser history, reverse-proxy logs or SSE
payloads. Every retry/reconnect obtains a fresh ticket; native EventSource retry
is not used because it would replay a consumed ticket.

### Revocation and expiry

Authenticating only at ticket issuance is insufficient for a long-lived stream.
Before accepting delivery and at every heartbeat, the server revalidates the
bound session epoch and expiration.

Password change, recovery, reset or **Sign out other devices** invalidates old
streams. A revoked stream receives no later product event and closes either on
the next attempted event or heartbeat, whichever comes first. Its client then
reconnects through the normal ticket path; if it no longer has a valid bearer
token, the common API/session-lost flow returns it to login.

## Server transport behavior

Each accepted HTTP stream subscribes once to `SseHub`. The route sends each
serialized payload as one SSE `data` frame and emits a `:ka` comment every 25
seconds while idle. The heartbeat keeps proxies from treating an idle stream as
dead and bounds session-revocation recognition.

### Backpressure

A disconnected or slow browser must not own unbounded server memory. Each SSE
connection has a bounded pending buffer:

- at most 4,096 queued events;
- at most 8 MiB of UTF-8 serialized payload.

Crossing either limit closes that connection instead of dropping an arbitrary
middle event. The browser reconnects with a fresh ticket and consumers recover
from authoritative snapshots. Buffer accounting must subtract drained entries
and count bytes, not JavaScript character length.

Hub subscriber failure is isolated: one connection cannot stop broadcast to
other tabs/devices. Abort, overflow and route exit always unsubscribe.

## Event catalog

### Durable chat state

| Event | Payload/meaning |
|---|---|
| `chat-created` | complete list-ready `ChatDTO` |
| `chat-deleted` | deleted chat ID; remove every local remnant |
| `chat-archived-changed` | chat ID plus current archived state; move between lists and make an open CLI transcript read-only or writable |
| `chat-pin-changed` | chat ID plus current pinned state |
| `chat-model-changed` | chat ID plus authoritative provider/model pair |
| `chat-execution-mode-changed` | chat ID plus current Normal/Plan mode |
| `title` | chat ID plus current title |

Single-chat events carry the resulting server value, not merely the requested
value. Bulk archive emits one archive event per changed chat. Events are
idempotent because the initiating HTTP response and its SSE echo can race.

### Run and transcript state

| Event | Purpose |
|---|---|
| `run-started` | persisted user message and new run identity |
| `run-status` | admission state: `queued` or `running` |
| `delta` | assistant text fragment |
| `thinking` | reasoning fragment |
| `tool` | tool start/output/done/error projection |
| `steering-delivered` | assistant boundary plus delivered user input |
| `queue` | exact durable pending-input upsert/remove/start change |
| `system-message` | persisted timeline marker |
| `done` | successful terminal identity |
| `error` | stable terminal failure and optional persisted message |
| `confirm` | retained engine-neutral confirmation event where a policy uses it |

The pi bridge and run service own translation/orchestration; detailed behavior
is in the pi and agent-flow documents.

### Snapshot invalidation

`local-machines-changed` carries no machine list. It means:

> The known/connected computer projection changed; fetch
> `GET /v1/local-tools/machines`.

It is emitted when:

- a local transport attaches;
- a local transport detaches or expires;
- PWA, tray or CLI changes a computer's access policy.

The persisted server snapshot deduplicates stable machine identities and
contains permission plus online state. Sending only an invalidation avoids
publishing partial connection-derived lists and keeps the server authoritative.

Software-update status is not a `StreamEvent` unless a future accepted design
adds an actual server producer and consumer contract. PWA installation/update
signals remain in the dedicated browser service-worker path.

### Additive schema rollout

New event kinds require a new `EVENT_STREAM_VERSION`. `SseHub` withholds those
kinds from subscribers whose ticket declared an older version; established
events remain broadcast normally. Legacy clients continue converging through
initial/resume snapshots instead of receiving an unknown discriminant. The
current archive/model event additions require version 2.

Removing or changing an existing event payload is not made safe by this header;
such a breaking wire change requires the formal client-compatibility policy and
an appropriate minimum-client-version decision.

## Ordering and identity

The hub preserves publication order for a given process and connection. It does
not assign a durable global event ID and supports no `Last-Event-ID` replay.
Clients must not infer persistence, exactly-once delivery or cross-restart
ordering from arrival order alone.

Run events carry `chatId` and `runId`. High-rate fragments also carry monotonic
per-run `seq` values. A client seeded from a live HTTP snapshot ignores
fragments at or below the snapshot sequence and ignores stale run IDs.

State-change handlers are idempotent. The same change may be observed first by
SSE and later by the initiating HTTP response. The CLI filters archive changes
to its currently open chat, keeps that transcript visible and changes local send
permission without auto-restoring it. A send rejected with `chat_archived`
converges to the same state when an event was missed or raced the request.
Terminal/lifecycle events order after all earlier fragments delivered to that
browser.

## Browser delivery classes

`stream-event-batcher.ts` batches only `delta`, `thinking` and `tool` until the
next animation frame. This limits React/store work to browser paint cadence
without changing wire frequency.

Before any non-fragment event, the batcher:

1. cancels the pending frame;
2. flushes queued fragments in arrival order;
3. delivers the lifecycle/state event immediately.

Stop/logout clears buffered data so transcript fragments from one authenticated
lifetime cannot appear in another.

## Retry and foreground recovery

On an EventSource error, the service closes it and requests a new ticket after
exponential backoff:

- first retry: 500 ms;
- doubles after each failed attempt;
- maximum delay: 15 seconds;
- a successful open resets the delay.

Opening a retry connection notifies resume subscribers to fetch authoritative
state missed during the gap.

A real `hidden` → `visible` transition forces replacement even when the old
EventSource still claims to be open. iOS may suspend the socket and timers while
leaving stale ready state. A BFCache `pageshow` with `persisted=true` follows the
same path. Foreground recovery:

1. cancels backoff;
2. invalidates a pending ticket attempt;
3. closes the prior EventSource;
4. starts a fresh-ticket connection immediately;
5. notifies snapshot consumers once without waiting for SSE data.

Initial `pageshow` is not a resume and must not create a second connection.

## Snapshot and event convergence

SSE has no replay, so reliable product projection uses three complementary
mechanisms:

1. initial HTTP snapshot when a consumer mounts;
2. incremental/invalidation events while connected;
3. HTTP snapshot after reconnection or foreground restoration.

A snapshot replaces or reconciles disposable client projection; it never
trusts that every event arrived. Consumers issuing overlapping refreshes use a
request generation or equivalent rule so an older response cannot overwrite a
newer state.

Examples:

- Installation fetches machines initially, on `local-machines-changed`, on
  retry-open and foreground recovery;
- chat lists fetch open/archived snapshots on mount and resume while applying
  lifecycle events live;
- an open transcript refetches server messages/live/FIFO state on reconnect;
- routes remove a selected chat immediately after `chat-deleted`.

Consumers that unmount while in Settings or another explorer need not retain
local listeners if their next mount performs the authoritative initial query.
The EventSource itself remains session-wide.

## Polling policy

Do not add periodic polling where initial snapshot, invalidation events and
resume recovery provide convergence. Polling must not mask a missing producer,
consumer or lifecycle repair.

Purpose-specific polling remains allowed when the remote operation itself has
no event contract, such as an interactive OAuth transcript or a deployment
state actively transitioning. Such polling is scoped to the mounted/busy
operation and is not evidence that product SSE failed.

The local-computer projection must not poll periodically.

## Local Access channel separation

For a PWA permission change:

```text
PWA ── PATCH machine policy ──▶ server persistence
                                  ├── PLA policy frame ──▶ tray/CLI
                                  └── local-machines-changed ──▶ every PWA
```

For a tray/CLI permission change:

```text
tray/CLI ── PLA set_access ──▶ server persistence
                                 └── local-machines-changed ──▶ every PWA
```

SSE never runs local tools and PLA never substitutes for browser state
synchronization. Browser selection stores stable `machineId`; request handling
resolves it to the current live tray-preferred connection after reconnect.

## Security and privacy

- Ticket issuance requires a currently authenticated bearer token.
- The event GET is public only in middleware topology; a valid one-use ticket is
  mandatory.
- Ticket comparison is constant-time for equal-length candidates.
- Ticket/session state is memory-only and bounded by short expiry.
- Session revocation and expiration apply to streams already open.
- Event payloads never contain bearer/provider credentials, local file contents
  or secret machine data not required by the product projection.
- Events notify state; they do not authorize mutations or tool calls.
- Unknown/malformed browser event JSON is ignored rather than executed.
- Buffered private fragments are cleared on stop/logout.
- The hub is not an audit trail. Durable security/accounting records belong to
  their explicit stores/logs.

## Failure behavior

| Failure | Required outcome |
|---|---|
| Ticket request fails | backoff and retry through authenticated API |
| Ticket is invalid/spent/expired | 401; obtain another ticket |
| Server restarts | stream ends; new ticket plus snapshots converge |
| Network gap | run continues server-side; retry-open triggers snapshots |
| App sleeps | foreground forces replacement and snapshot refresh |
| Old async ticket resolves | generation rejects it |
| Superseded EventSource errors | it cannot affect the current source |
| Slow subscriber exceeds limits | disconnect only that subscriber; recover by snapshot |
| Session epoch/expiry changes | stop delivery and close by next event/heartbeat |
| Malformed event frame | ignore it without breaking later frames |
| Consumer snapshot responses race | only newest request generation applies |

## Test obligations

Changes to the event channel require focused tests plus `npm run gate`. The
suite must cover:

- ticket entropy shape, expiry, session/schema binding, single use and invalid values;
- unauthenticated ticket refusal and ticket-only GET access;
- revocation/expiry of an already-open stream;
- hub mapping for every event, broadcast isolation and legacy-version filtering;
- bounded UTF-8 pending-buffer count/bytes;
- EventSource idempotency during ticket issuance;
- stale ticket response after stop/restart;
- fresh ticket and snapshot notification after retry;
- hidden/visible and BFCache replacement;
- superseded source errors and messages;
- animation-frame batching and lifecycle flush order;
- run ID/sequence stale-event rejection;
- initial, invalidation and resume snapshots;
- out-of-order snapshot-response protection;
- local-machine attach/detach/policy publication without polling;
- cross-device chat create/delete/archive/pin/model/mode/title convergence;
- end-to-end HTTP/SSE smoke through the fake engine.
