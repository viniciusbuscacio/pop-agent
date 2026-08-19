# Pop Agent — frontend and PWA

**Status:** normative
**Legacy coverage:** §14
**Primary implementation:** `web/src`, `web/vite.config.ts`, `web/public`
**Normative set:** all documents under `docs/specs/`, entered through `Spec-Pop-General.md`

> Section numbers are preserved from the former monolithic specification so
> existing code comments remain traceable. Cross-section references resolve
> through the legacy section map in `Spec-Pop-General.md`.

## Scope

The Pop Agent frontend is one React application delivered as a responsive web
app and installable PWA. The same built client runs in phone browsers, installed
standalone windows and wide desktop browsers. There is no separate native
desktop UI or native installer.

The frontend owns:

- boot presentation, protected routing and browser-session handling;
- responsive navigation and page composition;
- client-side interaction, optimistic presentation and rollback;
- HTTP/SSE service adapters and snapshot reconciliation;
- transient live-run state, device preferences, drafts and caches;
- Markdown/tool/attachment rendering;
- PWA installation, update prompt, offline shell and push reception;
- accessibility, i18n and design-system conformance.

The server remains authoritative for product state and policy. The frontend may
cache, predict and reconcile, but it may not become the authority for chats,
messages, queue delivery, permissions, execution mode, Files, tasks, providers
or security decisions.

Focused specifications retain subsystem detail:

- HTTP DTOs, resources and errors: [Spec-Pop-API.md](Spec-Pop-API.md);
- SSE ordering, batching and reconnect recovery:
  [Spec-Pop-Events-Synchronization.md](Spec-Pop-Events-Synchronization.md);
- UI primitives and visual language: [Spec-Pop-Style-Guide.md](Spec-Pop-Style-Guide.md);
- install and update channels: [Spec-Pop-Installation.md](Spec-Pop-Installation.md);
- Files and backup authority: [Spec-Pop-Memory-and-Storage.md](Spec-Pop-Memory-and-Storage.md);
- auth and browser-visible security: [Spec-Pop-Security.md](Spec-Pop-Security.md);
- optional selected-computer access: [Spec-Pop-Local-Access.md](Spec-Pop-Local-Access.md);
- outbound trusted-agent configuration and task views:
  [Spec-Pop-A2A.md](Spec-Pop-A2A.md);
- pi run and queue semantics: [Spec-Pop-Pi-Agent-Integration.md](Spec-Pop-Pi-Agent-Integration.md).

## 14. Frontend architecture

```text
main.tsx
  └── App / BrowserRouter
        ├── routes/       page composition and navigation
        ├── ui/           reusable visual and interaction primitives
        ├── store/        Zustand client projections and device choices
        ├── services/     HTTP, SSE, browser integration and caches
        ├── lib/          framework-light presentation helpers
        ├── i18n/         user-facing strings
        └── styles/       semantic tokens and global layout rules
```

### Layer responsibilities

- **Routes** compose screens, select store slices and coordinate interactions.
  They may own page-local state but do not call browser network primitives.
- **UI components** render reusable controls and specialized chat/file
  surfaces. They receive behavior through props or focused stores.
- **Stores** hold browser projections and interaction state. They may call
  services and reconcile responses/events, but may not define server policy.
- **Services** are the only door to HTTP, SSE, IndexedDB, service workers,
  passkeys, push and other external browser integration.
- **Libraries** hold deterministic presentation helpers such as model
  selection, resend lookup, scroll-follow decisions and time formatting.
- **Shared DTOs** come from `@pop-agent/shared`. The frontend does not redefine
  wire contracts or import backend domain entities.

`eslint.config.js` rejects direct `fetch` and `EventSource` use outside
`web/src/services/`. `tools/check-ui-primitives.ts` rejects private control
skins and forbidden native form controls. Both checks run in the gate.

The frontend has legitimate rules of interaction and synchronization; “the app
only paints” is not the architecture. The actual boundary is that durable
product decisions remain server-owned while the client owns presentation,
device behavior, cache and convergence.

## Runtime and build

- React 19 runs in `StrictMode` with React Router, Zustand and TypeScript.
- Vite builds the production assets into `web/dist`; the Hono server serves
  that exact output from the same origin as the API.
- Development uses `vite build --watch`, not a second public dev-server port.
- Tailwind CSS v4 consumes semantic CSS variables defined by the style system.
- The product version is compiled from root `VERSION`; Settings must show the
  build loaded on this device rather than accidentally substituting the server
  process version.
- Browser history routes require the server's PWA fallback, but `/v1/*`,
  `/healthz` and signed Files views must never be replaced by `index.html`.

## Boot and session lifecycle

`main.tsx` applies theme and font state before rendering and mounts `App`.
`App` keeps global connection, update and toast surfaces above the protected
route tree so login/setup failures still receive honest status.

Boot asks `GET /v1/auth/state` and chooses one of four states:

- `loading` — boot is unresolved;
- `needs-setup` — route to `/setup`;
- `signed-out` — route to `/login`;
- `signed-in` — start the one SSE connection and allow protected routes.

A session rejected with `invalid_session` is cleared once and navigates to
login. A wrong password is an ordinary form failure and must not trigger the
global lost-session path.

### Token storage

- “Keep me signed in” stores the token in `localStorage`.
- Otherwise the token uses `sessionStorage` and ends with the browser session.
- Silent token renewal replaces the token in the selected store.
- If browser storage is denied, an in-memory fallback keeps the current page
  usable but intentionally cannot survive a reload.
- Sign-out/invalid-session clears both token stores and the authenticated
  transcript cache. Cached conversation text must never leak into a later
  session on the same browser profile.
- Session tokens never enter query strings. SSE obtains a one-use ticket through
  the authenticated API.

## Route map

Public/session-establishing routes:

| Route | Purpose |
|---|---|
| `/setup` | first-owner setup |
| `/login` | password/passkey entry |
| `/recover` | recovery-key flow |

Protected application routes:

| Route | Purpose |
|---|---|
| `/` | unselected explorer/list shell |
| `/chat/:chatId` | conversation |
| `/files`, `/files/*` | Files root or folder |
| `/files/trash` | recoverable Garbage entries |
| `/tasks`, `/tasks/new`, `/tasks/:taskId` | task explorer/editor |
| `/skills`, `/skills/new`, `/skills/:slug` | skill explorer/editor |
| `/mcp`, `/mcp/new`, `/mcp/:id` | MCP explorer/editor |
| `/settings/*?section=<id>` | Settings index or destination |

Unknown routes replace to `/`. Route order keeps `/files/trash` ahead of the
Files wildcard.

## Responsive shell and navigation

Pop Agent uses route-based navigation, not hidden drawers:

- On narrow screens, the explorer/list is the screen. Selecting a chat, folder,
  task, skill or MCP server navigates to a separate screen, so browser/OS back
  gestures have truthful history.
- On wide screens, the explorer remains in a fixed left pane while the selected
  content occupies the remaining width.
- The sidebar app bar lives at the bottom above the scrolling list and exposes
  wordmark, Settings and degraded-health diagnosis.
- The list reserves bottom space so its last item is never hidden behind the
  app bar.
- Forms do not open in side drawers. Creation/editing uses routes or full page
  content panes.
- Context actions use visible pressable controls. Long-press-only, hover-only
  and touch gestures that compete with native scrolling are not primary UI.
- The document, pane, transcript and composer remain horizontally contained
  before and after focus. Ordinary long text wraps; code and tables own bounded
  horizontal scrollers.

## Settings information architecture

Settings is a searchable hierarchy, not a row of tabs:

- **Agent:** Models & Providers, Audio, Instructions, Memory, Auto-skills,
  MCP, A2A;
- **App:** Appearance, Notifications, Updates, Installation;
- **Data:** Storage, Backup;
- **System:** Server & Connections, Security, About.

A destination deep-links as `/settings?section=<id>`. On a phone, Back returns
from destination to Settings index and then to the unselected app list. On a
wide screen, index and destination share a 95%-viewport split view and Back
returns to the chat/explorer that opened Settings. Route state is preferred;
the session's last active chat is the fallback after reload/direct entry.

Binary state uses switches, multiple-choice state uses selects, and buttons
perform actions. Save flows provide Cancel. Large accessibility fonts must not
truncate provider identity, allowance or actions merely to preserve a desktop
row.

Installation derives the current same-origin server at runtime. It never embeds
one deployment's URL or advertises a native wrapper that does not exist.

## State ownership

| State | Browser representation | Authority / lifetime |
|---|---|---|
| Chat lists, messages, queue, live runs | Zustand chat store | server snapshots/events; current page |
| Files, tasks, skills, MCP projections | focused Zustand stores | server snapshots; current page |
| Auth routing status | Zustand auth store | current page plus token presence |
| Session token | local/session storage or memory fallback | server-issued credential |
| Transcript warm cache | IndexedDB | disposable device cache |
| Theme, font, thinking visibility | localStorage-backed stores | device preference; thinking visibility covers reasoning, ordinary tools and subagents |
| Update-check preference | localStorage-backed store | device preference |
| Per-chat draft | localStorage | device-local unsent text |
| Last active chat / selected local computer | browser storage | device navigation/context |
| Component menus, dialogs, scroll intent | React local state/refs | mounted component |
| App shell/assets | service-worker Cache Storage | generated build, never product data |

A store must preserve object identity when its selected value did not change.
Streaming one chat must not force unrelated screens or settled history rows to
re-render.

## Service boundary

`services/api.ts` centralizes:

- `/v1` base path;
- bearer token and client/platform headers;
- optional selected-local-connection header;
- JSON encoding and structured `ApiError` mapping;
- renewed-session header handling;
- connection-monitor evidence from every success/failure;
- binary download and multipart upload variants.

Feature services expose typed product operations and hide paths/methods from
routes and components. Browser-only integration likewise remains in services:
SSE, health, IndexedDB, push, passkeys, PWA install/update and session storage.

A response of any HTTP status proves that the server is reachable. Only a fetch
that does not land proves transport failure. A 204 or successful empty response
must not be parsed as JSON.

## Synchronization and recovery

One authenticated PWA instance owns one EventSource. Stores subscribe to the
session-wide stream and filter/apply relevant events.

- Initial mount fetches the relevant HTTP snapshot.
- Incremental SSE events update or invalidate that snapshot.
- Reconnect obtains a fresh event ticket and notifies resume subscribers.
- Returning from background reconnects promptly when needed and refreshes
  snapshots because iOS may have dropped events while suspended.
- Consumers guard against an older request overwriting newer state.
- Periodic polling is not a substitute for a missing invalidation/reconnect
  path. Health and update checks are deliberate exceptions with separate
  purposes.

High-rate `delta`, `thinking` and `tool` fragments are queued until at most one
animation-frame delivery. Every non-fragment event first flushes queued
fragments and then delivers immediately, preserving terminal ordering.

Detailed ticket, retry and event rules live in the Events specification.

## Chat projection and reconciliation

The chat store holds separate records for:

- open and archived chat summaries;
- settled messages by chat;
- one live buffer per active chat;
- complete server-owned pending-input FIFO by chat;
- pending sensitive confirmation;
- latest visible failure.

Events are matched by chat, run and monotonic sequence. A fragment at or below a
snapshot's `seq` is ignored. A run started on another device is adopted when no
local live buffer exists. Recently finished run IDs are remembered in a small
bounded set so delayed terminal fragments are not mistaken for a new run.

Opening/reopening a chat replaces local product history with the server
snapshot, including live and pending state. Optimistic user messages and local
terminal marks improve immediacy, but the next snapshot replaces them with
stored truth.

Chat create, pin and execution-mode updates are idempotent because SSE may beat
the initiating HTTP response. Execution mode updates optimistically and rolls
back only if no newer event/user choice has superseded the attempted value.
Deletion treats server `not_found` as convergence and removes every local cache,
live, queue and routing remnant.

## Persistent transcript cache

`services/chat-cache.ts` provides a best-effort IndexedDB cache named
`pop-agent-chat-cache`, with one `transcripts` record per chat.

- It stores the latest bounded transcript snapshot returned by the server.
- Opening a chat starts cache and server reads together, paints cached content
  when available, then reconciles with the complete current server snapshot.
- The server request is still the normal messages snapshot; there is no separate
  revision-check endpoint in the current API.
- Each record stores encoded byte size and last-access time.
- The global budget is 50 MB. Writes evict least-recently-used records until
  under budget; a single record larger than the budget is not retained.
- Reading refreshes recency. Chat deletion removes its record. Session clear
  deletes the entire database.
- IndexedDB denial, private browsing, quota pressure and cache corruption must
  degrade to ordinary online loading without breaking chat.
- Cached content is never treated as proof that a chat still exists or that its
  run state is current.

A future lightweight revision API requires coordinated API/Backend design; the
frontend must not assume or simulate one.

## Streaming rendering and scroll

- Settled transcript rows are memoized by stable message object identity.
- The settled transcript subtree is memoized independently of the live answer.
- Historical Markdown must not be reparsed for each streamed fragment.
- Live text/thinking/tool updates render no more than once per animation frame.
- Run status occupies a permanently reserved line above the composer. Queued,
  working and approval status animate locally; SSE does not carry animation
  frames.
- Thinking is visible by default and the device preference redraws live and
  settled answers without deleting reasoning.
- Tool fragments fold into one record per call and consecutive ordinary calls
  present as a compact group. Calls named exactly `delegate_worker` are excluded
  from that group and render in a dedicated quiet, collapsible **Subagents** card
  inline at their first position relative to the ordinary tool group. The card
  uses the existing active, done, failed and interrupted status semantics and
  reveals bounded progress or result detail when expanded.
- Markdown, tool output and long paths cannot widen the transcript. Code/table
  surfaces scroll internally when wrapping would destroy meaning.

Autoscroll is polite:

- follow only while the reader is at the latest content;
- upward wheel/touch intent disarms follow before native scroll settles;
- touch listeners remain passive and never take ownership of pan;
- streaming never drags a reader back from older content;
- follow resumes only after returning to the bottom or pressing “jump to
  latest”;
- the floating control overlays rather than resizing the scroller.

## Composer, pending input and voice

The composer owns device-local draft interaction, not delivery authority:

- drafts are keyed by chat in localStorage and survive reload;
- each chat keeps a device-local history of its latest 100 successfully submitted
  composer messages; Arrow Up recalls older entries and Arrow Down returns toward
  newer entries and the preserved draft without taking over multiline caret movement;
- failed sends retain exact text, attachments and Files references;
- Enter sends, Shift+Enter inserts a line, and Escape stops a live run;
- attachment-only input can be sent with blank text, while a completely empty
  composer cannot be submitted;
- drag/drop, picker and paste support attachments, with frontend limits matching
  API limits (eight items, 16 MB each);
- `@` references existing Files paths without uploading them again;
- model and Plan controls snapshot their current values into each send;
- Plan styling and announcement make mode visible, but only the server enforces
  tool restrictions;
- pending input remains visible as ordinary user bubbles with edit/cancel;
- presentation distinguishes `Sending`, `Waiting` and explicit `Queued` without
  exposing internal queue machinery as another composer panel.

Legacy `pop-agent.queued.*` localStorage entries are read only for one-time
migration into the server-owned queue and are deleted only after accepted
server state proves they are safe to remove.

Voice uses the browser's `MediaRecorder`, uploads a data URI through the voice
service and receives cleaned text. A successful transcription is sent together
with any existing draft; if send/queue fails, the merged text becomes the
recoverable draft. Leaving the chat stops an active recorder and its media
tracks.

Slash/session commands are recognized client-side only where they invoke a
specific API/UI action. Local command output is visible transcript UI but never
pretends to be durable model context.

## Model and provider presentation

The selected model identity is the `(provider, model)` pair. The picker:

- shows configured providers and the global default;
- separates provider choice from large model catalog filtering;
- names the effective provider/model when following the default;
- keeps recent available pairs first;
- never flattens every provider into one unscannable catalog;
- updates only the open chat.

Provider status, authentication, failover and service-model policy remain
server-owned. Frontend catalog failures produce an honest empty/degraded picker,
not invented model data.

## Files and other explorers

Chats, Files, Tasks, Skills, MCP and A2A share the route-based explorer
pattern, but their server authorities remain distinct. A2A lives under the
Agent settings/integration area next to MCP and uses route/full-pane list and
editor flows, never a side drawer. Save always has Cancel. The editor supports
a same-origin relative Agent Card path and Microsoft Entra tenant, client,
scope and write-only client-secret fields, plus a Foundry v1 preset. Its browser
projection shows credential presence and bounded persisted task state; only a
frontend service calls the guarded API, and the browser never contacts a remote
Agent Card or A2A endpoint directly.

The Files UI:

- renders the live server tree by real path;
- supports folders, upload, search, preview/download and selection;
- moves delete requests to Garbage and shows an immediate undo action using the
  exact returned Garbage handle;
- restores parent selections before separately selected children;
- never uses a stale frontend catalog as Files authority;
- requests signed links from the API rather than constructing signatures;
- treats hidden metadata and path-jail decisions as server policy.

The detailed Files layout, retention, provenance and backup rules live in the
Memory and Storage specification. Task execution, skill policy and MCP protocol
likewise remain in their focused specs; the frontend owns their list/editor
interaction only.

## Health and offline UX

A connection banner above the route tree distinguishes:

- device offline (`navigator.onLine === false`);
- internet available but personal server unreachable;
- recovery (“Back online” briefly).

An unreachable server is a full-width non-modal banner with a real retry and
“Try now”, not a subtle status dot. Already loaded content stays readable. A
reachable but degraded server uses the sidebar health diagnosis for provider or
DB trouble.

Health cadence:

- reachable/degraded: one cheap `/v1/health` keepalive per minute;
- unreachable: retry after 5 seconds, exponential to 30 seconds;
- hidden/pagehide: stop polling;
- visible/pageshow/online/offline: probe immediately;
- device definitely offline: skip impossible network requests.

Every ordinary API request also updates reachability evidence immediately. The
health probe uses `no-store`; cached health is not health.

The service worker may keep the shell readable offline, but no UI may imply
that server-owned actions succeeded while disconnected. Failed send/draft state
must remain recoverable.

## PWA installation

The PWA manifest declares standalone display, same-origin scope/start URL,
regular and maskable icons, theme/background colors and HTTPS-secure behavior.
Safe-area and dynamic viewport units support installed mobile windows.

Chromium's one-shot `beforeinstallprompt` is captured at module boot before
Settings mounts. Installation:

- is offered only when the browser reports eligibility;
- starts from an explicit user gesture;
- opens the browser-owned confirmation;
- reports Installed in standalone mode or after `appinstalled`;
- gives honest Add to Home Screen/Dock/menu instructions on Safari/iOS and
  unsupported/ineligible browsers;
- never claims silent installation is possible.

## Service worker and update lifecycle

The generated Workbox service worker precaches only the app shell/assets.
`/v1/*`, health and signed Files views are network-only or excluded from
navigation fallback. Product data is not placed in Workbox runtime caches.

Registration occurs exactly once in `services/pwa-update.ts` with prompt mode.
Device-local Settings controls automatic checks and interval; the current
default is enabled every 10 minutes. Checks run on the interval, on return to
visible and on explicit user action. Disabling automatic checks preserves the
manual action.

Applying an update must reach the newest available build with one user action:

1. call `registration.update()` at click time;
2. if a newer worker is still `installing`, wait for its `statechange` to a
   terminal installation state;
3. select the resulting newest `waiting` worker rather than an older worker
   that was already waiting;
4. send `SKIP_WAITING` only after installation completed;
5. reload once on `controllerchange` or worker activation;
6. start the 8-second fallback only after installation, never while the new
   precache is still downloading.

The active page may still contain an older handler from before this rule shipped;
one final manual browser reload can be necessary to acquire the fixed client.

## Web Push

`push-sw.js` is imported into the generated worker and owns `push` plus
`notificationclick`. A received push always creates a user-visible notification;
clicking focuses an existing client at the deep link or opens one.

The device-scoped opt-in lives under Settings → Notifications. Permission is
requested inside the user's click, then the browser subscription is registered
with the server. Unsupported contexts and iOS not installed to Home Screen show
honest requirements instead of a dead toggle.

Which server events send notifications is server policy, not frontend policy.
The PWA must render any accepted notification safely, keep its deep link
same-origin and never embed credentials in notification URLs.

## Rendering, i18n and accessibility

- User-facing strings come from the lightweight English i18n dictionary.
  Components do not scatter hard-coded translatable prose.
- Markdown uses `react-markdown` plus GFM without raw HTML execution.
- Shiki highlighting follows light/dark themes and provides copy/language UI.
- Untrusted text is rendered as text/Markdown data, never injected as HTML.
- Images use bounded previews; other attachments show readable file identity.
- Lucide and approved product marks provide icons. Emoji are not substitutes
  for control icons.
- Form failures render inline; asynchronous cross-screen outcomes may use the
  owned toast system.
- Interactive controls have accessible names, visible focus and keyboard
  operation. Icon-only controls require `aria-label`.
- Streaming/status changes use appropriate polite live/status semantics and
  sensitive confirmation remains an inline alert dialog.
- Tests prefer role/name semantics. Stable kebab-case `data-testid` is used
  when semantic queries cannot uniquely express the product element.

Detailed control variants, tokens, responsive typography and prohibited styles
live in the Style Guide specification and `docs/ui-style-guide.md`.

## Frontend security boundaries

- The browser never enforces Plan Mode, local-access permission, Files jails or
  action authorization; it displays server decisions.
- Session credentials go only in authorization headers or browser storage, not
  URLs, logs, local drafts or IndexedDB transcript metadata.
- Event payloads update presentation but do not authorize follow-up actions.
- External/provider/server text remains data. React escaping and no-raw-HTML
  Markdown are the rendering floor.
- Signed Files URLs are treated as opaque, short-lived links.
- Logout removes authenticated transcript cache as well as credentials.
- Service-worker caches contain public app assets, never API responses.

## Frontend test obligations

Frontend work uses the smallest relevant unit/component tests plus the full
gate. Depending on the concern, coverage includes:

- deterministic lib/store tests for reconciliation, ordering and rollback;
- service tests for API envelopes, health cadence, SSE batching, IndexedDB
  eviction/failure and service-worker lifecycle;
- component tests through accessible roles/names and user events;
- route tests with MemoryRouter for narrow/wide navigation semantics;
- style/token and UI primitive checks;
- production build and smoke from the Hono-served `web/dist`.

Performance-sensitive chat tests must prove:

- a frame batches multiple fragments;
- terminal events flush fragments before immediate delivery;
- settled message rows retain identity across live updates;
- a large prior transcript does not re-render its Markdown for each delta;
- scroll intent disarms follow without blocking native pan;
- cached history paints before server reconciliation;
- LRU/oversized/denied-cache paths remain bounded and safe.

PWA update tests must cover an old waiting worker plus a newer slow installing
worker, installation-before-activation, fallback timing and reload-once.

Automated DOM tests cannot prove every installed-device behavior. Release checks
for relevant changes explicitly cover:

- iPhone/iPad installed PWA foreground/background recovery;
- Android/Chromium install prompt and standalone detection;
- service-worker update on a throttled/slow connection;
- microphone permission, recording teardown and transcript send recovery;
- push while the app is closed and notification deep links;
- passkeys in a real secure context;
- phone back gestures and desktop split panes;
- large accessibility fonts and horizontal overflow.

Before completion run `npm run gate`: specs/self-map, lint, typecheck, UI checks,
frontend build, complete tests and smoke.
