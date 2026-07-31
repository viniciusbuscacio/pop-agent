# Changelog

All notable changes to Popy. Dates are ISO. See `popy.spec` for the full
normative history.

## Unreleased

### Fixed

- **Every delete from the UI looked dead**: the API layer parsed JSON out of
  every ok response, but a DELETE answers 204 with no body, so the parse threw
  after the server had already deleted — the row never left the screen. Chats,
  artifacts, skills, backups and passkeys were all affected.
- **Unarchiving a chat made it vanish from both lists** until a reload: the
  store only removed it from the active list and refreshed the archived one.
  Both lists refresh now.
- **The composer showed a scrollbar on a single line**: the auto-grow height
  missed the 2px of border (border-box) and left the box permanently 2px short
  of its content. The scrollbar now appears only once the composer hits its
  one-third-of-the-screen cap, like aw's.

### Added

- **Home list redesign**: Chats | Artefacts segments on top; search reaches
  archived chats (badged); archived browsing moved to the ... menu. The
  Artefacts segment lists every artifact across every chat.
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
- **Artifact versioning and history** (RF-018/019): re-saving a file under the
  same name in the same chat keeps the previous bytes as a numbered version.
  `GET /v1/artifacts/:id/versions` lists the history; each version downloads
  through its own signed link (the version folded into the HMAC). The artifacts
  screen shows the current version. Validated live: two uploads produced v2+v1,
  and each version downloaded its own bytes.
- **Text extraction and OCR for read_artifact** (RF-011/012): non-text
  artifacts are extracted best-effort before the agent gives up — PDF via
  `pdftotext`, DOCX via `unzip` of the document XML, images via `tesseract`
  OCR (por+eng). System binaries, not heavy JS deps. Validated live: the agent
  read a PDF's text and OCR'd a PNG.
- **`read_artifact` agent tool** (RF-011/016/017): the agent reads a
  conversation's artifact by id or exact name (scoped to that chat), getting
  text content through the safety envelope; binary files are reported, not
  inlined. Closes the loop with uploads — validated live (uploaded a note, the
  agent read it back).
- **`save_artifact` agent tool** (RF-001): the agent writes a file in its
  workspace and calls `save_artifact(path)` to promote it into a tracked,
  downloadable artifact for the conversation (path jailed to the workspace).
  Validated live against the real pi bridge.
- **Artifacts screen + upload** (RF-002/009): a full-screen artifacts view per
  conversation (reached from the chat header) that uploads a file, lists what a
  chat holds, downloads through a freshly minted signed link, and deletes.
  Upload is `POST /v1/chats/:chatId/artifacts` (multipart, 25 MB cap).
- **Artifacts — HTTP surface, disk store and signed downloads** (RF-001/002-list/
  004–008): an on-disk blob store grouped per chat under the data directory, a
  service that creates/lists/deletes artifacts and mints links, authenticated
  routes to list a chat's artifacts / mint a signed link / delete one, and a
  public `GET /artifacts/:id/download` that carries no session — the HMAC in the
  URL is the whole authorisation (bad signature → 403, expired → 410, unknown
  → 404). Deleting a chat now also deletes its artifact bytes.
- **Artifacts foundation** (RF-001/003–008, backend groundwork toward v0.3): an
  `artifacts` table keyed by an unguessable `file-<base62>` id, a SQLite repo
  with the same collision-retry discipline as chats/messages, and HMAC-signed
  download links derived from `secret.key` — the signature covers the id and the
  expiry together, so a tampered expiry fails as a bad signature; links default
  to a 30-day life and expiring a link never touches the artifact. HTTP surface,
  the on-disk store, the artifacts screen, upload, OCR and versioning follow in
  later blocks (see `docs/artifacts-attachments-downloads.md`).

### Fixed

- **PWA update prompt now actually appears.** An installed PWA (and an
  already-open desktop tab) only re-checked its service worker on
  navigation, so a shipped fix could sit unseen for days. The client now
  checks on a device-chosen interval (Settings → Appearance → App updates,
  default 10 minutes), whenever the app is resumed, and on a manual
  "Check now" button. The server marks `sw.js` and the HTML shell
  `no-cache` while keeping hashed assets `immutable`, so a stale worker can
  no longer be pinned by a heuristic cache.

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
