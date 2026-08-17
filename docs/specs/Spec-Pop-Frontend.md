# Pop Agent — frontend and PWA

**Status:** normative
**Legacy coverage:** §14
**Primary implementation:** web/src
**Normative set:** all documents under `docs/specs/`, entered through `Spec-Pop-General.md`

> Section numbers are preserved from the former monolithic specification so
> existing code comments remain traceable. Cross-section references resolve
> through the legacy section map in `Spec-Pop-General.md`.
## 14. Frontend rules (web/)

- The React app only paints. No business rules. Components never call
  `fetch`/`EventSource` — only `web/src/services/*` does (enforced by
  ESLint restricted-imports; gate fails otherwise). Types come from
  `shared/`, never redefined.
- Layout: ChatGPT-style without inventing — sidebar (chats, filter, New,
  archived), central column, composer. **The app bar (wordmark + Settings)
  lives at the BOTTOM of the sidebar**, floating above the endlessly
  scrolling list (the list keeps a padding-bottom so the last row is never
  hidden), and carries the **health indicator**: silence means healthy —
  nothing renders while `/v1/health` is all `ok`; a *degraded* server (it
  answered, but something inside is sick) shows a small gently pulsing red
  button (opacity animation, never stroboscopic) whose tooltip/click names
  the diagnosis ("LLM provider disconnected", "Database disconnected").
  Diagnosis only; maintenance actions come later. **Narrow screens follow the
  Telegram model rather than a drawer**: the list *is* the screen, and
  opening something is a route change, so the phone's back gesture means
  what the user expects.
- The model **M** changes only the open chat. Its picker is deliberately
  two-stage: first **Providers** (configured providers only, plus the global
  default), then every model from the chosen provider with an immediately
  focused text filter and a back-to-providers action. When the chat follows
  that global default, the selected row names the effective provider and model
  instead of the opaque “Default model”. Choosing a model appends the selected
  provider and model to the chat transcript, just like `/model list`. A large
  OpenRouter catalogue never shares one flat list with the other providers.
- The composer puts a round **P** immediately beside the model's **M**. Its
  per-chat value is durable server state, changed through the existing chat
  PATCH and broadcast as `chat-execution-mode-changed` over the same SSE path
  as create/delete/pin; every connected device follows immediately, while a
  reconnect recovers it from `ChatDTO`. Active styling, `aria-pressed`, a
  read-only placeholder and an in-app state announcement make the mode visible.
  Every send path, including voice transcription and the durable queue, snapshots
  the selected execution mode; the UI never tries to enforce the policy itself.
- **A server the app cannot reach is announced, not hinted** — a full-width
  bar at the top of every screen (`ui/connection-banner`), above the router
  so the failed boot's fallback to login carries it too. The dot is for
  diagnoses the user could act on; an unreachable server is a wall, and the
  PWA hides it well: every screen still paints from the service worker's
  cache, so the app looks alive and only the answers stop. Three states,
  because the next move differs in each — **"You're offline."** (the device
  has no network: theirs to fix), **"Server is offline."** + *"Your internet
  is working — the problem is on the server. Nothing you typed was lost.
  Trying to reconnect…"* (naming the culprit is the point; without it the
  first suspect is always the wi-fi), and **"Back online."** for 3s, because
  an outage that ends in silence leaves you poking at the app to find out
  whether it is safe to type again. A bar, never a modal: the conversations
  already loaded stay readable. "Trying to reconnect…" is only honest if it
  is true, so the retry is real, plus a "Try now" button.
- **Connection cadence** (`services/health`): healthy it is a keepalive —
  one `/v1/health` a minute; unreachable it is a retry — 5s doubling to 30s,
  because the only thing anyone wants then is the moment it comes back.
  `navigator.onLine === false` skips the request entirely (nothing can
  succeed with the radio down) and tells the two failures apart. Nothing runs
  while the page is hidden: iOS freezes a backgrounded PWA within seconds, so
  a surviving timer would only resume holding a verdict from whenever the
  system suspended it — the poll stops on `pagehide`/hidden and fires
  immediately on `pageshow`/visible, the same pair `services/events` uses.
  **The wake-up probe matters more than the interval.** Every real request is
  also a probe: `services/api` reports a fetch that never landed at once
  (waiting up to a minute would leave a send that did nothing unexplained)
  and any answer, a 500 included, clears it just as fast.
- **Never a side drawer/panel for forms** (permanent veto). Settings is a
  full-screen, route-based hierarchy rather than a strip of tabs. Its searchable
  English index groups destinations as **Agent** (Models & Providers, Audio,
  Instructions, Memory, Auto-skills), **App** (Appearance, Notifications,
  Updates, Installation), **Data** (Storage, Backup), and **System**
  (Server & Connections, Security, About). On a phone the index and destination
  are separate screens so the native back gesture has a truthful destination;
  wide screens retain the same hierarchy as an index/content split view. The
  desktop split view uses 95% of the viewport with no fixed maximum width, and
  destination content expands across its pane instead of stopping at a tablet-
  sized ceiling. On desktop, Settings remembers the selected chat or explorer
  pane that opened it, and Back from either the index or a destination returns
  there directly. The last active chat is also kept for the browser session so
  this return survives a Settings reload or an entry path without route state.
  On phones, Back from a destination first returns to the
  Settings index, then to the unselected app list. Binary settings use switches
  and choices among multiple values use selects;
  buttons perform actions rather than representing state. At large accessibility
  font sizes, provider cards stack identity, details, allowance and actions
  vertically; provider names and allowance text remain readable rather than
  being truncated to preserve a desktop row. The installation
  guide derives the current personal server origin at runtime and gives
  copyable installation instructions for the PWA and CLI on Windows, macOS and
  Linux. There is no native Desktop wrapper or native installer. It never
  hard-codes one deployment's URL.
  Chromium's one-shot `beforeinstallprompt` is captured during application boot,
  before Settings mounts. When the browser offers it, Installation shows
  **Install Pop Agent** and opens only the browser-owned confirmation after that
  user gesture; it never claims a page can install silently. Running standalone
  shows Installed, while Safari/iOS/unsupported or ineligible browsers receive
  their honest Add to Dock/Home Screen/menu instructions instead of a dead
  button.
  Every Save has a
  Cancel. **Model means the model that answers you** -- the whisper model
  and the transcript cleanup moved out to Audio (Vinicius, 03/08), because
  under Model they sat beneath a heading about something else and anyone
  looking for the microphone had no reason to open it.
- Rendering v0.1: markdown (react-markdown + remark-gfm, sanitized, no raw
  HTML) + code highlight (Shiki, themes synced light/dark, copy button,
  language label). Mermaid/KaTeX: later.
- Streaming UX (aw's machine as reference): runId registry, reload
  reconciliation mid-run, polite autoscroll + "jump to latest", auto-title
  via SSE, and per-chat drafts in localStorage. Delta, thinking and tool
  fragments are delivered to React at most once per animation frame, and
  settled transcript rows keep stable memoized renders: a long conversation
  must not reparse all historical Markdown for every new fragment. Lifecycle
  events flush queued fragments first and remain immediate. While an answer
  streams, any reader gesture toward older content suspends autoscroll immediately, before
  iOS applies its native scroll; the intent listener stays passive and the
  floating control must not resize the scroller or interfere with native pan.
  Streaming must not pull the viewport back to the bottom. Following resumes
  only when the reader moves back to the latest content or taps "jump to
  latest". The transcript itself never scrolls horizontally: ordinary text,
  paths and long tokens wrap within the column, while code and tables retain
  their own bounded horizontal scroll areas. The document root is horizontally
  contained too, and the pane, transcript viewport and composer form each keep
  the same containment before and after focus; focusing the composer cannot
  merely shift an outer page overflow out of sight. **Run activity is a separate line immediately above the composer,
  in both web and CLI**: queued is a static “Waiting for a free slot…”, running
  is a locally animated Braille spinner plus “Working…”, and `done`/`error`
  removes its content. The web permanently reserves the line's height so an
  answer settling never shifts the transcript vertically. Text, thinking and
  tool cards never replace this line; tool
  spinners describe one call, while `run-status` describes the whole run. The
  clients animate locally -- SSE never carries presentation frames. Thinking
  is visible by default in both clients. The web stores that choice in device
  localStorage; the CLI stores it in its separate device-local preferences
  file. `/think` redraws live, settled, historical and pre-steering assistant
  segments immediately, and settlement never discards reasoning already shown.
  The **pending-input FIFO is
  server-owned**: ordered SQLite rows survive restart. The complete FIFO is
  returned with the message snapshot, while incremental add/edit/remove events
  keep phone, desktop and tabs in sync; the current head remains on the wire for
  older clients. Every pending input stays visible with edit/cancel controls,
  and the composer remains available to append more. A POST racing an active
  run appends atomically; the defensive ceiling is 1,024 pending inputs per
  chat, so only item 1,025 is
  refused with `queue_full`. While pi is running with the same terminal local connection,
  Pop offers every contiguous `steer` item through pi's native steering queue
  and explicitly sets `steeringMode=all`: the whole accepted batch enters after
  the current assistant turn and its tool calls, before the next model call.
  Each item stays durable until pi emits its matching user-message event.
  `/queue <message>` is a FIFO barrier and the explicit escape hatch to the old
  behavior: it persists
  `delivery_mode=follow_up` and is not offered to pi until the live run ends.
  Delivery persists the assistant segment before it, inserts the user bubble,
  advances the FIFO and continues under the same run id. Pending inputs are
  painted in FIFO order as ordinary user bubbles: the steering head says
  `Sending:`, later steering says `Waiting:`, and explicit follow-up says
  `Queued:` because it waits for the current run to finish. No separate composer
  strip exposes the internal steering vocabulary. Until pi emits that
  user-message event the SQLite row remains authoritative, so a restart or an
  unavailable steering channel degrades into the ordinary follow-up path instead
  of losing input. ID-addressed PUT and DELETE edit or cancel any pending item;
  the legacy routes still target the head. Text, uploads and Files references
  survive PWA reclamation and server restart.
  Legacy `pop-agent.queued.*` localStorage rows migrate on first open.
- **Adoption**: an event for a chat with no live buffer starts one, so a run
  begun on another device streams into every open window. Runs that already
  ended are remembered briefly, so their stragglers are ignored rather than
  adopted as something new.
- Context menus are **visible buttons, not long-press**: a hidden gesture has
  no affordance on a touch screen and fights the scroll, and hover-only
  controls are invisible to keyboards.
- Thinking: collapsed streaming card. Tool calls: card per call with
  real-time output; consecutive calls group. Sensitive-action confirmation
  renders inline in the chat (§10).
- Chat titles: a chat is born with the deterministic starter **"Chat N"**
  (lowest free N among the living chats) and keeps it through the user's first
  two messages. There is no first-message word-picking rename.
- Auto-title (LLM): ONE background call after the 3rd user turn writes TITLE
  (≤40 chars, at most six words) + SUMMARY together, using the chat provider's
  service model and the conversation's language. It is a one-time naming pass,
  not a periodic rewrite. A refused request, unavailable provider or unusable
  parse (<2 chars = failure) leaves **"Chat N"** untouched. Manual rename
  disables auto forever, and a successfully titled chat is not revisited.
  Every skip logs its reason (manual-rename, cadence, already-titled,
  same-title…) so "why didn't it rename?" is one log line. The summary lands on
  the chat row and feeds the recent-chats catalog (§7.1) — infinite chats stay
  indexed. `chat_titles` is append-only: every title, its user turn,
  auto|manual.
- Files the agent creates: download link in chat when a tool reports a
  file + a workspace file browser.
- Slash commands: `/model`, `/model list`, `/new`, `/memory`; extensible menu on `/`.
  `/model` opens model selection; `/model list` adds a client-side system message
  with the provider and model currently active for that chat and never sends it
  to the model.
- Voice (v0.2): aw's pipeline copied as-is — MediaRecorder → upload →
  ffmpeg (WAV 16k mono) → whisper.cpp (`whisper-cli`, `base` default,
  HF download with SHA1 pin, `-l auto`) → best-effort LLM cleanup. Check
  in aw whether the transcript lands in the composer and replicate.
- UI in English; strings structured in a light i18n layer from day one
  (simple dictionary, no heavy lib) so PT-BR can land later without
  retrofit.
- Icons: Lucide. No emoji as icons. Toasts: own implementation, top-right,
  theme-tinted, async events only; form errors inline.
- `data-testid` on every interactive control, kebab-case and named after
  the thing (`setup-password`, `login-submit`, `settings-theme-dark`);
  basic real a11y (visible focus, keyboard nav, `aria-live` on streaming).
- **Every field control comes from `ui/controls.tsx`** — `TextField`,
  `Select`, `TextArea`, `CheckField`, plus `Button`, `Card` and
  `Segmented`. A hand-rolled `<select>` or `<textarea>` with its own class
  string is a bug waiting to be fixed N times; they had already drifted
  apart before the primitives existed. The field skin lives in one
  constant and the two sizes (`md` for a labelled form field, `sm` for a
  toolbar control) are a **prop, never a `className` override**: two
  competing `px-` classes are settled by the order Tailwind emitted them,
  not the order they were written.
  - A primitive given no `label` renders bare, so a toolbar keeps its flex
    row instead of gaining a wrapper — and then `aria-label` is mandatory,
    because it is the only name the tree will ever get.
  - Layout classes (widths, `flex-1`) still come through `className`; only
    the skin is owned by the primitive.
  - `tools/check-ui-primitives.ts` parses production TSX before TypeScript and
    rejects native `button`/`input`/`select`/`textarea` outside the primitive
    implementation, hand-written menu shells, duplicate focus treatments,
    literal component colors and private skins passed through `className`. A
    new kind of control is added to `ui/controls.tsx` first; feature
    code cannot create a private visual dialect. The maintained catalog and
    usage rules live in `docs/ui-style-guide.md`.
- Theme: follows the system (`prefers-color-scheme`) + manual
  System/Light/Dark override. **Never sent to the server** — it belongs to
  the device, lives in `localStorage`, and is applied by an inline script
  before the first paint so the wrong colours never flash. Two token maps;
  regression test: every theme defines every token. App icon: friendly mascot, designed later — v0.1
  ships a simple placeholder.
- PWA: app-shell precache; API/SSE never cached; SW update prompt. iOS:
  HTTPS required, safe-areas, `dvh`. Android: WebAPK via manifest. Offline
  is honest: shell + "Pop Agent is offline". Web Push in v0.2 — exactly two
  triggers: "run finished" and "agent needs confirmation" (the second is
  still to be wired).
- **Web Push, end to end**: `push-sw.js` is imported into the generated
  service worker (`workbox.importScripts`) and owns `push` (always shows a
  notification — `userVisibleOnly` demands it) and `notificationclick`
  (focus an open window at the deep link, or open one). Settings →
  Appearance carries the device-scoped opt-in, which asks for permission
  inside the click itself (iOS refuses a prompt that is not in a user
  gesture) and registers the subscription with `/v1/push/subscribe`. A
  finished run calls `PushService.send`; a subscription the service reports
  gone (404/410) is deleted.
- **The VAPID `sub` claim is not a formality.** It is a contact URI for the
  application server, and Apple *validates* it: `web.push.apple.com`
  answers **403 `BadJwtToken`** for a subject it dislikes, silently — the
  phone simply never rings and nothing in the UI says why. `@localhost` is
  the trap: a perfectly good address for a machine talking to itself, and
  not a domain Apple accepts. Pop Agent signs with a real public URL by default;
  `POP_AGENT_PUSH_SUBJECT` sets the operator's own `mailto:` or `https:` URI,
  and a value that would be rejected upstream is **dropped for the default
  rather than honoured** — a typo in an environment variable must not
  quietly switch every notification off.

### Files as a plain folder (supersedes RF-001–019)

> Redesigned in 1.58: Files stopped being a catalog over id-named blobs and
> became a directory. The paragraphs below are the target state; the previous
> design (`save_artifact`/`read_artifact`, id-addressed downloads, versions,
> the path index) lives in the changelog if a rollback ever needs it.

- **`POP_AGENT_DATA_DIR/files/` is the single source of truth.** Real names, real
  subfolders. The Files tab renders the tree as it is on disk — a `readdir`
  walk, no `artifacts` table, no `file-` ids, no path index. What `tree`
  shows over SSH is exactly what the tab shows. Hidden entries (dotfiles)
  are reserved for Pop Agent's own metadata and are never listed.
- **The agent sees Files as a folder.** `Files/` is exposed inside the
  workspace root, so the built-in `read`/`write`/`bash` tools already cover
  it: "save something for the user" means writing `Files/relatorio.pdf`.
  `save_artifact` and `read_artifact` retire. The system prompt teaches one
  rule — *a file the user asked for is not done until it exists under
  `Files/`; the rest of the workspace is scratch.*
- **Overwrite is the feature.** Saving a name that exists replaces it. No
  versions, no history (`artifact_versions` is gone). What the user wants
  from "save it again" is the new file (Vinicius, 05/08).
- **Provenance is a log, not a catalog** (Vinicius, 05/08): the
  `file_provenance` table (§6) records "chat X wrote `Files/foo.pdf` at T",
  append-only, written by the server as it serves the tree. It answers
  "which files did this chat produce" without ever having to be right about
  where the file is *now* — history cannot desynchronize.
- **The trash is a folder.** Deleting from the UI moves the entry into
  `files/Garbage/`; the agent deletes through a **`delete_file(path)` tool
  whose real effect is that same move** — never `rm` (Vinicius, 05/08: a
  rule enforced by a tool beats a rule taught in a prompt). A hidden
  `Garbage/.garbage.json` records `{originalPath, deletedAt}` per entry —
  the `.trashinfo` idea from the Linux desktop. Restore moves it back; a
  daily sweep purges what is older than 30 days. Self-healing by design: a
  file with no entry purges by its own mtime and restores to the Files
  root; an entry with no file is dropped on the next sweep. The delete endpoint
  returns the exact Garbage entry it created (collision-safe handle included),
  and the UI immediately shows an actionable “moved to Trash” notice with
  **Restore**; batch undo restores parents before separately selected children.
- **Downloads stay HMAC-signed, now over the path.**
  `GET /files/download?path=<rel>&expires=<ms>&sig=<b64url>` — the
  signature covers path+expiry and is checked before the expiry, so
  tampering with either fails as a bad signature. Path resolution refuses
  `..`, absolutes and symlink escapes (the same jail the workspace already
  has). 403 forged, 410 expired, 404 unknown; expiry is a property of the
  link, and a fresh one can be minted any time.
- **Search is by name, live.** `files_search(query)` walks the tree at
  query time and matches names and paths — no index, no watcher, no
  embeddings (Vinicius, 05/08: names only for now). Content search, if it
  ever returns, is an index keyed by path+mtime, out of scope here.
- **Uploads** (`POST /v1/files`, multipart, 25 MB cap) land in the folder
  open in the tab (the root by default). Multimodal input is unchanged:
  image attachments still go inline to models that accept image input;
  text-only models keep the file-on-disk path.
- **Migration**: one boot-time walk of the old `artifacts` table writes
  each latest version to `files/<folders>/<name>` (older versions are not
  carried over), seeds `file_provenance` from the rows' chat ids, then
  drops `artifacts`, `artifact_versions` and the folders table and removes
  `POP_AGENT_DATA_DIR/artifacts/`. `FilesReindexJob` and the id-based routes go
  with them.

## Related normative specifications

- [Spec-Pop-Events-Synchronization.md](Spec-Pop-Events-Synchronization.md)
- [Spec-Pop-Style-Guide.md](Spec-Pop-Style-Guide.md)
