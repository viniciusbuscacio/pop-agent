# Changelog

All notable changes to Popy. Dates are ISO. See `popy.spec` for the full
normative history.

## Unreleased

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
