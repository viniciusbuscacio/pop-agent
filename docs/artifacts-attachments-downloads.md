# Artifacts, attachments and secure downloads — plan (Rodada 3 / v0.3)

> **HISTORICAL — superseded 2026-08-05.** The artifact catalog this plan
> built — the `artifacts` table, versions, id-named blobs, per-id signed
> links, `save_artifact`/`read_artifact` — was replaced by Files as a plain
> folder (pop-agent.spec 1.58/1.59, §4/§6/§14). Nothing below is normative; it
> stays as the record of what was built and why it could be retired.

> The normative rules land in `pop-agent.spec`; this file is the working plan the
> maintainer's notes call RF-001–019. It is split into blocks that each end on
> a green gate and a small commit. No block waits for manual acceptance
> (working model, pop-agent.spec §19/§20); the final iPhone checklist collects what
> only a device can confirm.

## What exists before this (verified 2026-07-31)

- **Attachments** ride as data URIs on the message row (`attachments_json`,
  16 MB cap), and the pi bridge also writes each into
  `POP_AGENT_WORKSPACE/attachments/<chatId>/` so the agent's tools can open it.
- **No artifact model**: a file the agent writes lives in the workspace with no
  record, no download link and no UI. There is no signed-URL mechanism; the one
  existing download (backup) is session-authenticated.
- **IDs** already have the `file-<11 base62>` shape (`domain/ids.ts`) — RF-003
  is a naming decision that is already true.

## Blocks

### Block 1a — Artifact record + signed-download core (backend, no HTTP) ✅

The security foundation, fully unit-tested, touching no routing so it cannot
regress the running server.

- `artifacts` table (migration 010): `id` (`file-…`), `chat_id`
  (`ON DELETE CASCADE`), `name`, `mime`, `size`, `version`, `source`,
  timestamps. Bytes live on disk, never in the row.
- `domain/artifacts/artifact.ts`: the entity + `createArtifact` (draws a
  `file-` id).
- `application/ports/artifact-repo.ts`: the port.
- `infrastructure/db/sqlite-artifact-repo.ts`: insert (with one id re-draw on a
  PK collision, per §6), get, list-by-chat, delete.
- `application/artifacts/artifact-download.ts`: HMAC signer keyed off
  `secret.key` (never a fresh secret). `payload = fileId + '.' + expiresAt`,
  `sig = HMAC(HKDF(secret,"pop-agent.artifact.download.v1"), payload)`. Verify checks
  the signature **before** expiry, so a tampered `expires` fails as a bad
  signature, not as "expired". Default link TTL 30 days (RF-007).

### Block 1b — HTTP surface + disk store + cascade (RF-001/002-list/004-008)

- `infrastructure/artifacts/artifact-store.ts`: write/read/remove bytes under
  `POP_AGENT_DATA_DIR/artifacts/<chatId>/<id>`; remove a chat's whole folder.
- `application/artifacts/artifact-service.ts`: register-from-workspace, list,
  get, delete, mint-link.
- Authenticated routes (`/v1`): list a chat's artifacts, mint a signed link,
  delete an artifact. Never expose a filesystem path or storage key (RF-008):
  the Artifact ID is the only identifier that leaves the server.
- Public route (outside `/v1`, no session): `GET /artifacts/:id/download` —
  validates the HMAC, rejects bad/expired/unknown (RF-006), streams the bytes
  with the original name as the download filename.
- Extend `FsChatPurger` to delete `artifacts/<chatId>/` when a chat is deleted
  (RF: deleting a conversation deletes its artifacts too).
- A tool the agent calls to promote a workspace file it just wrote into a
  tracked artifact.

### Block 2 — Artifacts screen (RF-002)

Claude-style: per conversation, list / open latest / download / delete /
version history. Full-screen view, never a drawer (house veto).

### Block 3 — Upload + extraction (RF-009/010/011)

Upload through the chat; store → mint Artifact ID → extract text →
make it available to the model. Extracted text passes the safety
sanitize+envelope (an attachment is external content, even from the owner).

### Block 4 — OCR + multimodal (RF-012/013/014/015)

OCR for images and scanned PDFs before the model; send the file directly when
the conversation's default model is multimodal, otherwise extract to text.

### Block 5 — Versioning + audit (RF-016/017/018/019)

Reference by Artifact ID or original name; a change makes a new version;
audit rows (extend `llm_runs`/a new table) record id, name, user, model,
timestamps.

## Cross-cutting rules

- HMAC secret derived from `secret.key`; no new standalone secret.
- Extracted/OCR'd content is untrusted; it goes through the §10 safety layer.
- Artifacts live under `POP_AGENT_DATA_DIR` so they ride the backup (they are user
  content); attachments stay in the workspace (not backed up), as today.
- Everything in English in the repo; gate green before each commit.
