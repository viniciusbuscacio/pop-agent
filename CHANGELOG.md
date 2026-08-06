# Changelog

All notable changes to Popy. Dates are ISO. See `popy.spec` for the full
normative history.

## Unreleased

### Added

- **Files is a plain folder on disk.** `POPY_DATA_DIR/files/` with real
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
- **`popy` -- the terminal client, with hands.** A chat in the terminal is
  an ordinary Popy chat (same memory, budget, taint guard, PWA visibility),
  but a message typed in a terminal hands the agent a second set of tools --
  `local_bash`, `local_read`, `local_write`, `local_edit` -- running on the
  machine that typed it, over a dedicated WebSocket hands channel with a
  heartbeat. Hands belong to the message, not the chat: each message runs on
  the machine it was typed on; a phone message gets the server's tools only.
  TUI built on pi-tui, one-shot mode (`popy "…"`), login and per-server
  profiles. The server serves its own client
  (`npm i -g https://your-popy/cli-X.Y.Z.tgz`) and the attach compares
  versions: silent when compatible, one line when merely behind, refused
  below the server's minimum.
- **`popyman` -- the operator's tool.** `start | stop | restart | status |
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
- **Settings -> Updates**: three cards -- the PWA update check, the Popy
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
  anyone. Popy now signs with a real URL, and `POPY_PUSH_SUBJECT` lets the
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
- Popy does not update itself from the running process; the update is a gated
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
  past conversations, and a living document Popy keeps about you.
- **Local voice** — record a note, transcribed on the server with whisper.cpp,
  no tokens spent.
- **PWA** — installable, offline shell, update prompt, the final Popy icon.

### Security

- Deleting a chat deletes everything it left behind: rows, pi's JSONL session,
  and the chat's attachments.
- The provider key never leaves the server; the secret key file is excluded
  from backups.
