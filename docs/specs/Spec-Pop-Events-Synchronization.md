# Pop Agent — Real-time event synchronization

**Status:** normative
**Normative source:** this modular specification set
**Primary code:** `server/src/application/ports/event-sink.ts`, `server/src/interface/http/sse-hub.ts`, `server/src/interface/http/event-tickets.ts`, `web/src/services/events.ts`
**Related:** [`../agent-flow.md`](../agent-flow.md)

## Purpose

The SSE channel synchronizes server state into the PWA and carries live run output. It is not a software update channel.

```text
server ── SSE ──▶ PWA
   ▲               │
   └──── HTTP ─────┘
```

HTTP sends actions and obtains snapshots. SSE sends changes and streaming. PLA is a separate server-to-local-computer protocol.

## Connection and authentication

Each authenticated PWA instance owns one EventSource through `web/src/services/events.ts`. Because EventSource cannot set the session authorization header, connection is two-step:

1. authenticated `POST /v1/events/ticket`;
2. `GET /v1/events?ticket=...`.

The random ticket lasts 30 seconds, is consumed once and is not the account session token. Every reconnect obtains a fresh ticket.

## Publication

Application services emit `RunEvent` through the application-owned `EventSink`. `SseHub` maps each event explicitly to the shared `StreamEvent` DTO, serializes it and broadcasts it to connected clients. Pop Agent is single-user, so all authenticated tabs and devices receive the same product stream and filter what they need.

The authoritative event union lives in `shared/src/index.ts`.

## Delivery classes

`delta`, `thinking` and `tool` may arrive faster than a browser can paint. `stream-event-batcher.ts` queues only those fragments until the next animation frame. Lifecycle and state events flush pending fragments and deliver immediately, preserving order.

## Incremental updates and invalidation

Some events contain the exact change, such as a deleted chat ID or a text fragment. Others invalidate a snapshot.

`local-machines-changed` means: fetch the current machine state with `GET /v1/local-tools/machines`. It is emitted when a local connection attaches/detaches and when access policy changes. The event does not carry a possibly incomplete machine list.

## Snapshot recovery

SSE has no durable replay in the current design. Consumers therefore combine:

- initial HTTP snapshot;
- live SSE events;
- snapshot refresh after reconnection;
- snapshot refresh when the PWA returns from background.

Reconnect starts at 500 ms exponential backoff capped at 15 seconds. On visibility restoration, iOS/Safari handling reconnects promptly and notifies resume subscribers. Consumers must prevent an older snapshot response from overwriting a newer one.

## Polling rule

Do not add periodic polling where initial snapshot, invalidation events and reconnect refresh cover the state. Polling must not conceal a broken SSE lifecycle.

## Security

- Ticket issuance requires an authenticated session.
- The session token never enters the EventSource URL.
- Events do not authorize actions.
- Secrets and local file contents do not belong in state events.
- The hub is ephemeral delivery, not an audit log.

## Change checklist

Test ticket expiry and single use, multi-subscriber broadcast, exact event mapping, fragment batching, reconnect with fresh ticket, foreground recovery, initial/refetched snapshots, out-of-order responses and absence of obsolete polling.
