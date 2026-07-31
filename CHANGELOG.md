# Changelog

All notable changes to Popy. Dates are ISO. See `popy.spec` for the full
normative history.

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
