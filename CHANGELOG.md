# Changelog

All notable changes to Pop Agent. Dates are ISO. See `pop-agent.spec` for the full
normative history.

## Unreleased

### Changed

- **The menu-bar helper now presents the single product name Pop Desktop.** Its
  technical process and executable remain `Pop Desktop Tray`, while the menu
  title, tooltip, dialogs, diagnostics title and Quit action no longer expose
  that implementation detail.
- **Pop Desktop now ships with Pop Desktop Tray inside one app bundle.** Opening
  Desktop starts the internal tray helper; closing either process closes the
  other. The former standalone Pop Desktop Manager is no longer a separate app,
  installer, login item or update target.
- **CLI installation commands can stay current.** The stable, non-cacheable
  `cli-latest.tgz` URL redirects to the server's exact immutable CLI package,
  so setup instructions do not need a version edit after each update.
- **Windows can install the CLI from one server-specific command.** The new
  same-origin `install.ps1` bootstrap installs a compatible Node LTS when
  needed, installs this server's exact CLI package, and prints the login
  command. CLI self-update now invokes `npm.cmd` correctly on Windows.
- **CLI reasoning now matches the web.** It is visible by default, stays in the
  transcript after an answer settles, survives steering boundaries, and
  `/think` redraws both live and historical answers immediately. The choice is
  remembered in a device-local preferences file separate from login tokens.
- **The built-in skills got a review: 17 became 7.** The generic ones
  (writing, summarizing, translating, explaining, brainstorming, math,
  planning) are gone -- any current model does that natively, and each one
  was a candidate competing with YOUR skills in the router. What remains is
  what only Pop Agent knows: the manual, the codebase map, web research,
  notes, shell safety, the daily review and code work. Built-ins you never
  edited that left the roster are cleaned up on boot; one you edited becomes
  yours. And every skill can now be switched off without deleting it --
  built-ins included.
- **The skills list has a filter.** All Skills / Personal / Auto / Pending /
  Built-in, with the count of skills waiting for your approval right on the
  filter, so an auto-skill never waits invisibly.

### Fixed

- **`pop update` works on Windows.** It now runs npm's JavaScript entrypoint
  through the current Node executable instead of asking `spawn` to execute the
  `npm.cmd` shell wrapper, which failed with `EINVAL`.
- **CLI answers no longer appear above their local command log.** `ran here: …`
  notices stay inside the active assistant block, before its prose, instead of
  accumulating below the completed response in Windows Terminal.
- **The provider surface, end to end** (a review pass, nineteen findings):
  - Removing the provider that was answering no longer leaves the app pointed
    at nothing -- the head of the list is re-elected as the default the moment
    its key is cleared or the provider is deleted.
  - A provider that keeps failing now waits longer each time before being
    tried again (1, then 5, then 15, then 60 minutes) instead of a flat five
    -- and a connection test that passes, a saved key or one successful run
    forgives it at once.
  - Titles, summaries and voice cleanup now respect the same failover order
    as chat, skip a provider that is sitting out, and count what they spent:
    background work lands in the Usage ledger as `service` rows, with a
    subscription's token counts kept but its cost zero.
  - Retrying an answer on another provider no longer asks the model the same
    question twice -- the conversation is rewound before the retry, and a run
    that had already started thinking or calling tools is never silently
    re-executed somewhere else.
  - A provider whose sign-in expired shows it: a "sign in again" badge on the
    card instead of a run that only fails when you send it.
  - The model list for a provider is refetched when you change its key or
    endpoint, instead of showing yesterday's catalog.
- **Subscription sign-in completes the moment it completes.** The device-code
  card used to stay on "waiting" after approval: pi's login promise resolves
  only after post-login bookkeeping (remote catalogs, availability) that can
  stall on the network without a timeout. Now the flow resolves the instant
  the credential lands in `pi-auth.json`, bookkeeping runs in the background,
  and a saved-but-not-yet-visible provider appears in the list on save
  because configured-ness reads the auth file, not pi's lagging snapshot.
  The service also runs with `PI_OFFLINE=1`, so the bookkeeping is local by
  construction (catalog updates ride pi package upgrades).
  - A negative OpenRouter balance renders as `-$0.10`, the balance is fetched
    once per visit instead of once per redraw, and the enable/disable switch
    is back on each provider card.

### Added

- **Pop Agent learns from conversations you did not flag.** Every few minutes it
  reads one conversation that has gone quiet and, if something in it was a
  procedure worth keeping, writes it down as a skill. Nothing to press and
  nothing to remember -- and if there is nothing to learn, which is the usual
  answer, it costs nothing at all: a round with no new conversation makes no
  request to a model. Anything it writes waits for you on the Skills screen,
  the same queue as a skill you asked for.
- **A skill Pop Agent already knows gets a rewrite, not an overwrite.** When what
  it learned matches a skill you have, the new version waits beside the old
  one with the text laid out, and the skill you approved keeps working until
  you say yes. A conversation that read a web page is never learned from at
  all.
- **Learned skills have a ceiling.** Past fifty, the ones the router never
  reaches for are archived -- listed at the bottom of the Skills screen with
  a button to bring any of them back. Archived, never deleted: a skill used
  once a year is exactly the one a "delete what is idle" rule would throw
  away.
- **A line on the Skills screen says what Pop Agent has been doing**: when it last
  looked and how much is waiting on you. Settings → Skills can slow it down
  or switch it off.
- **A conversation can become a skill, by asking.** Say "vira skill" -- or
  the same thing in English or Spanish, or any way you phrase it -- and Pop Agent
  distils what just worked into a skill that comes back on its own the next
  time it is relevant. There is no button and no command to remember: the
  request is understood as a request. New skills wait for you on the Skills
  screen by default; a setting there lets them go live on their own if you
  come to trust them.
- **The Skills screen shows where each skill came from and what it earns.**
  A badge for built-in and for learned, a queue for anything waiting on your
  approval, and a use count per skill -- so a skill nothing ever routes is
  visible as such.
- **A Service Model per provider.** The model Pop Agent uses for its own work --
  naming conversations, summaries, tidying voice notes -- now sits beside
  each provider's key instead of being one global choice. It follows that
  provider's chat model until you pick something cheaper. The old single
  setting could not be right: a model id only means something inside one
  provider's catalogue, so an install that named a Moonshot model asked
  OpenAI for it the moment a chat ran there.

### Changed

- **The Skill Router picks better.** It now fuses its word-matching and its
  meaning-matching with the same reciprocal-rank fusion the memory search
  uses, and the bar for a semantic match is read from each request rather
  than being a fixed number -- measured against the real vault, that took
  routing from 4 correct out of 10 to 7, without adding a single wrong pick.
  Skill vectors are also kept on disk now, so the first message after a
  restart no longer waits for the whole vault to be re-read (16s to 2s).

### Fixed

- **A key pasted into a conversation can no longer leak into a skill.** The
  scrubber only caught secrets carrying a label ("api_key = …"); a bare
  `sk-…`, `ghp_…` or AWS id pasted on its own line sailed through into a
  skill body that future prompts would replay. The shapes recognizable by
  form alone are now redacted whole-line too.
- **"Don't create a skill" no longer creates a skill.** The explicit-request
  matcher heard the order inside the refusal ("não cria uma skill" contains
  "cria uma skill"). A negation word before the phrase now cancels it.
- **A small skills vault no longer admits its luckiest member.** With fewer
  than five skills to measure there is no spread to read, and the fallback
  floor sat inside the embedding model's noise band. The floor rises to the
  band's measured p90 there instead.
- **A revision proposed on a name collision no longer records a perfect fake
  score.** The similarity column exists to retune the dedup bars with real
  measurements; it now gets the measured cosine or nothing at all.
- **The learning tick no longer reads every conversation to learn nothing
  changed.** One query answers "anything new anywhere?" against the
  watermarks; histories open only when something actually moved.
- **A skill whose steps contain a command no longer gets thrown away.** Pop Agent
  asked itself for the procedure in a format where every quote and brace had to
  be escaped, so the moment a skill contained a real `curl` line the whole thing
  was discarded as unreadable. It now writes the procedure plainly, with nothing
  to escape.
- **A skill Pop Agent was writing no longer vanishes when the answer runs long.**
  If the model ran out of room mid-sentence, everything it had written was
  discarded and the conversation was marked as read, so a procedure it had
  just worked out was lost without a trace. It now keeps whatever finished and
  comes back for the rest.
- **Pop Agent no longer refuses to learn from conversations about itself.** The
  check that keeps it from learning anything out of a page it read was also
  reading your own messages, and it treats the words "system prompt" as a
  warning sign -- so the conversations most worth learning from, the ones
  about how Pop Agent works, were quietly the ones it always skipped. It now looks
  only at what a tool brought back from outside.
- **The injection detector stops flagging ordinary API notes.** Text like
  "send an Authorization header, and a session token" read as an attempt to
  steal a credential. It now also reads instructions it used to miss
  altogether: a secret smuggled out inside an image URL, a few more
  Portuguese phrasings, and an instruction hidden as base64.

- **Editing a learned skill really does make it yours.** The promotion was
  written to disk and then read straight back as "learned", so the automatic
  housekeeping still considered it its own.

- **Files is a plain folder on disk.** `POP_AGENT_DATA_DIR/files/` with real
  names is the single source of truth. The Files tab -- its own sidebar tab
  next to Chats and Tasks -- renders the disk: nested folders with a `+`/`−`
  toggle, "New folder", uploads landing in the open folder, rename and move
  as one path edit, and search (`GET /v1/files/search`, the agent's
  `files_search`) matching a name or any path segment live across the whole
  tree. The agent works in the same folder -- `Files/` inside its workspace
  -- so a file it saves there is immediately visible, downloadable through
  an HMAC-signed link that signs the path, and @-mentionable in the
  composer. Deleting moves to `files/Garbage/` (restorable from the Trash
  screen; a daily sweep empties it after 30 days), and the agent's
  `delete_file` makes the same move -- never a hard remove. "Which chat made
  this file" is `file_provenance`, an append-only log. The artifact catalog
  this replaces -- id-named blobs, the `artifacts` table, versions,
  `save_artifact`/`read_artifact` -- is gone; re-saving a name overwrites,
  as a folder should.
- **`pop` -- the terminal client, with hands.** A chat in the terminal is
  an ordinary Pop Agent chat (same memory, budget, taint guard, PWA visibility),
  but a message typed in a terminal hands the agent a second set of tools --
  `local_bash`, `local_read`, `local_write`, `local_edit` -- running on the
  machine that typed it, over a dedicated WebSocket hands channel with a
  heartbeat. Hands belong to the message, not the chat: each message runs on
  the machine it was typed on; a phone message gets the server's tools only.
  TUI built on pi-tui, one-shot mode (`pop "…"`), login and per-server
  profiles. The server serves its own client
  (`npm i -g https://your-pop/cli-X.Y.Z.tgz`) and the attach compares
  versions: silent when compatible, one line when merely behind, refused
  below the server's minimum.
- **`popman` -- the operator's tool.** `start | stop | restart | status |
  backup | backups | restore | reset-password | update`, shipped with the
  server and running only there; the only thing that touches systemd, SQLite
  and the backups directory.
- **Every message remembers where it came from**: `client`
  (`web | pwa | desktop | cli | api | task`), platform and IP are recorded
  per message, not per connection.
- **The agent sees its own scheduled tasks** (`list_scheduled_tasks`).
- **Delete every archived conversation in one step**, and a refresh button
  beside Settings.

- **Deleting a chat now stops what it was doing first**: the running answer is
  aborted (which kills the agent's process group) and anything of that chat
  still queued is dropped, before a single row is deleted. The chat's
  attachment folder in the workspace goes with it, as before.
- **Daily orphan sweep**: attachment folders whose chat no longer exists, and
  scratch files (*.png, *.yaml, *.mjs) sitting in the workspace root untouched
  for thirty days, are removed once a day. It never touches a live chat's
  files, a project directory, or anything outside the workspace — conversation
  history is never swept, only files derived from it.
- **Background tasks**: a sidebar tab next to Chats and Files. A task is
  a prompt with a schedule — once, or every N minutes/hours. Each run opens its
  own conversation named after the task and goes through the normal chat
  pipeline, so failover, compaction and error messages all apply and the result
  is readable like any other chat. Task runs are serialised: never two at once.
  Run now, an enabled switch, and a full-screen create/edit form.
- **Home list redesign**: search reaches archived chats (badged); archived
  browsing moved to the ... menu.
- **Swipe on a chat row** (touch): right = delete (confirmed), left =
  archive/unarchive.
- **Composer strip**: thinking visibility toggle (per device) and the model
  picker, under the composer instead of the header.
- **Font size** in Settings -> Appearance: Small/Default/Large/Extra large,
  remembered per device.
- **Restart resilience**: a server restart stores the partial answer of any
  in-flight run, marked as interrupted, instead of losing it.
- **Settings -> Updates**: three cards -- the PWA update check, the Pop Agent
  server card (latest origin tag + the update command, with a push
  notification per new version that deep-links here), and the environment
  versions (pi, Node, ffmpeg, poppler, tesseract, whisper.cpp).
- **Multimodal image input** (RF-014): when the conversation's model accepts
  images, image attachments are sent to the model inline instead of only being
  saved to the workspace. Gated on the model's declared input modalities, so a
  text-only model (the default) is untouched and still reads files with its
  tools.

### Fixed

- **PWA update prompt now actually appears.** An installed PWA (and an
  already-open desktop tab) only re-checked its service worker on
  navigation, so a shipped fix could sit unseen for days. The client now
  checks on a device-chosen interval (Settings → Appearance → App updates,
  default 10 minutes), whenever the app is resumed, and on a manual
  "Check now" button. The server marks `sw.js` and the HTML shell
  `no-cache` while keeping hashed assets `immutable`, so a stale worker can
  no longer be pinned by a heuristic cache.
- **Embeddings die with their messages**: deleting a chat no longer leaves
  its embedding rows behind.
- **A ghost chat can be deleted**, and the chat lists follow the foreground
  app instead of going stale.
- **Applying an API key no longer waits on provider catalogs**, and the
  elected provider pair follows the card it points at.
- **The danger zone says what each switch actually switches.**
- **The Files search box was a sliver on a phone**: the toolbar buttons filled
  the line and left it squeezed. It now drops to its own full-width line below
  them on a phone, and shares the row from `sm` up.
- **Push notifications never arrived on iPhone**: everything was in place — the
  service worker, the Settings opt-in, the subscription, the send when a run
  finishes — but the notifications were signed with a contact address ending in
  `@localhost`, which Apple rejects outright (403 BadJwtToken) without telling
  anyone. Pop Agent now signs with a real URL, and `POP_AGENT_PUSH_SUBJECT` lets the
  operator use their own address.
- **Every delete from the UI looked dead**: the API layer parsed JSON out of
  every ok response, but a DELETE answers 204 with no body, so the parse threw
  after the server had already deleted — the row never left the screen. Chats,
  files, skills, backups and passkeys were all affected.
- **Unarchiving a chat made it vanish from both lists** until a reload: the
  store only removed it from the active list and refreshed the archived one.
  Both lists refresh now.
- **The composer showed a scrollbar on a single line**: the auto-grow height
  missed the 2px of border (border-box) and left the box permanently 2px short
  of its content. The scrollbar now appears only once the composer hits its
  one-third-of-the-screen cap, like aw's.

## v0.2.0 — 2026-07-31

Everything on the v0.2 roadmap.

### Added

- **Skills and the Skill Router** — markdown skills the agent pulls in when a
  request calls for them, chosen by a pure lexical router; fifteen defaults led
  by *know-thyself*; a full-screen editor in Settings.
- **Backup and restore** — the data directory as a tar.gz (the encryption key
  excluded), created, downloaded, restored and deleted from Settings.
- **Web Push** — the server tells your phone an answer is ready even with the
  app closed; opt in per device.
- **Passkeys (Face ID / fingerprint)** — register a device and unlock with it
  instead of the password.
- **Local voice** — record a note, transcribed on the server with whisper.cpp,
  no tokens.
- **Cost dashboard** — total spend, tokens and runs, by model and by day.
- **Update status** — the installed versions and whether a newer pi exists,
  with the one-line update command.

### Notes

- Attachments reach the agent through its workspace; it extracts what it needs
  with its own tools rather than a bundled PDF/OCR pipeline.
- Pop Agent does not update itself from the running process; the update is a gated
  shell command.

## v0.1.0 — 2026-07-31

The first usable cut: a personal agent you talk to from your phone, that runs
real tools on your own server, remembers across conversations, and keeps notes.

### Added

- **Chat over HTTP + SSE** — streaming answers, thinking and tool cards, a
  queueing composer with attachments and voice, one run per chat with a global
  queue, Stop, and per-run usage accounting.
- **pi agent bridge** — the Kimi K3 model via OpenRouter, persistent sessions
  that survive a restart, the built-in read/bash/edit/write tools.
- **Provider configuration** — OpenRouter key (encrypted, write-only), a live
  model catalog with a labelled source, and a key test.
- **Auto-titles and summaries** written by the service model.
- **External-content safety** — a pure sanitizer (invisible-strip, injection
  patterns EN+PT) and a per-turn taint that pauses a destructive command in a
  tainted turn for an inline Allow/Deny.
- **Notes vault** — the agent's own markdown vault behind a path jail, with
  list/read/search/write tools.
- **web_fetch** — a public page in, its readable text out, with SSRF protection.
- **Memory** — full-text search over every message, tools to search and open
  past conversations, and a living document Pop Agent keeps about you.
- **Local voice** — record a note, transcribed on the server with whisper.cpp,
  no tokens spent.
- **PWA** — installable, offline shell, update prompt, the final Pop Agent icon.

### Security

- Deleting a chat deletes everything it left behind: rows, pi's JSONL session,
  and the chat's attachments.
- The provider key never leaves the server; the secret key file is excluded
  from backups.
