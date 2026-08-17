# Pop Agent — Frontend and PWA

**Status:** current architecture explanation
**Normative source:** `pop-agent.spec` §§13–15
**Primary code:** `web/src`

## Product role

The frontend is a React PWA served by the Pop Agent server. It paints server-owned product state and sends user actions through typed services. It is not a second agent and does not import pi.

The installed desktop product is the browser-installed PWA. Native desktop WebView wrappers are not part of the current architecture. Pop Local Access is an optional separate tray/runtime.

## Structure

- `web/src/App.tsx`: route tree and authenticated boot.
- `web/src/routes/`: screens and route-level composition.
- `web/src/services/`: HTTP, SSE, local persistence and browser integration.
- `web/src/store/`: cross-screen product state, especially chat streaming.
- `web/src/ui/`: reusable controls and visual primitives.
- `web/src/styles/`: semantic tokens and global behavior.
- `web/src/i18n/`: user-visible English strings.

## Service boundary

Components do not call `fetch` or create `EventSource` directly. Services own transport, auth renewal, errors and browser APIs. Shared DTOs define the wire.

One `eventStream` owns the EventSource for an authenticated app instance. Stores and screens subscribe to it and refetch snapshots after reconnect where events could have been missed.

## State

Server state remains authoritative. The PWA may use optimistic updates for responsiveness, but it reconciles against HTTP snapshots and SSE events. Device-local preferences such as theme or selected local machine stay in browser storage only when the product rule says they are device scoped.

## Chat rendering

Persisted messages and a live run buffer are separate. Stream fragments update the live buffer; terminal events and HTTP snapshots reconcile it into durable history. Run and queue identity prevent stale events from another tab or previous run corrupting the current view.

## PWA lifecycle

The service worker owns bundle installation and update activation. Settings exposes update state and the browser-native install prompt when available. Safari/iOS use manual installation guidance because browsers control the final PWA installation flow.

Returning from background must refresh state whose SSE events may have been lost. iOS suspension is a normal lifecycle case, not an exceptional failure.

## Navigation

Routes and Settings sections are derived into the built-in self-map by `npm run selfmap`. Deep links use `/settings?section=<name>`.

## Accessibility and UI law

Use the primitives in `web/src/ui/controls.tsx`, semantic design tokens and real accessible names. Pages own layout, not visual skins. See [Spec-Pop-Style-Guide.md](Spec-Pop-Style-Guide.md).

## Change checklist

For a frontend change:

- identify server-owned versus device-local state;
- use or extend a service instead of transport in a component;
- preserve loading, empty, error and reconnect states;
- test narrow and wide layouts;
- test installed-PWA and browser lifecycle where relevant;
- update English strings through i18n;
- use shared DTOs;
- run UI checks, component tests and the full gate.
