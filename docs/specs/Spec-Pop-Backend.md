# Pop Agent — backend and database

**Status:** normative
**Legacy coverage:** §6
**Primary implementation:** server/src, shared/src, server/migrations
**Normative set:** all documents under `docs/specs/`, entered through `Spec-Pop-General.md`

> Section numbers are preserved from the former monolithic specification so
> existing code comments remain traceable. Cross-section references resolve
> through the legacy section map in `Spec-Pop-General.md`.
## 6. Database (SQLite)

Single file `pop-agent.db`. Migrations numbered, run at boot.

```sql
chats(id, title, model, archived, pi_session_id, summary, auto_title,
      created_at, updated_at)
messages(id, chat_id, role, content, thinking, tools_json,
         attachments_json, created_at)
messages_fts      -- FTS5 external-content table over messages.content
message_embeddings(message_rowid, vector)       -- Float32Array BLOB, §7
chat_titles(chat_id, title, turn, source, created_at)  -- append-only, §14
user_memory(doc, backup, last_condensed_at)     -- single-row living doc
settings(key, value)                            -- JSON per key
secrets(key, value_encrypted)                   -- §9, secret.key encrypted
llm_runs(id, chat_id, provider, model, tokens_in, tokens_out,
         cost, created_at)                      -- cost accounting (§14)
skill_embeddings(slug, signature, vector)       -- router vectors, §8
skill_usage(slug, use_count, last_used_at)      -- what earns its slot, §8
file_provenance(id, chat_id, path, created_at)  -- append-only log, §14
```

- **IDs and internal file names** — two shapes, one CSPRNG generator (11 base62
  chars ≈ 65 bits, drawn by rejection sampling so there is no modulo bias):
  - **Entity id** = `prefix-<11 base62>` with a full-word prefix and a hyphen:
    `chat-Hq8Lm2XcN5R`, `message-…`, `run-…`, `file-…`. Nothing about the
    install leaks through an id. On a primary-key collision (astronomically
    unlikely, but defined) the repo re-draws the id and retries once — it never
    fails the request or overwrites.
  - **Internal file** = `prefix_<11 base62>.ext` with an underscore, for files
    Pop Agent makes itself (`audio_2f9FmGo58Jm.wav`, `text_…`). Created with an
    exclusive flag; on `EEXIST` it re-draws. The user's own files (attachments,
    notes) keep their names — the convention is for Pop Agent's internal artifacts.
- `messages.tools_json` holds **one record per tool call**, not per event: a
  call that starts, streams six lines and exits is one thing that happened.
  The frontend folds the live stream the same way, so a conversation reads
  identically while it streams and after a reload. Details accumulate in
  order (command, output, closing note).
- Message order is `(created_at, rowid)`. Ties are broken by insertion order
  because a question and a fast answer land in the same millisecond, and
  random ids cannot order them.
- Attachments travel and rest as data URIs on the message row (`attachments_json`),
  16 MB cap, and the pi bridge also writes each into
  `POP_AGENT_WORKSPACE/attachments/<chatId>/` so the agent's tools can open it.
- **Deleting a chat kills its work, then deletes everything it left behind.**
  `DELETE /v1/chats/:id` first stops what the chat has in flight
  (`RunService.discardChat`): the running attempt is aborted — which reaches
  down to pi killing the engine's process group — and anything of that chat
  still waiting for a slot is dropped without ever reaching the engine. Only
  then do the SQLite rows go (cascade), pi's JSONL session file and its
  sidecar folder, and the chat's `attachments/<chatId>/` directory — no
  orphans. **The order is the point**: a run still streaming into rows that
  are about to disappear would keep a process group alive, keep spending the
  user's own credit, and end by failing a foreign key. The aborted run unwinds
  afterwards, finds its chat gone, and stores nothing. The live pi session, if
  cached, is disposed first so nothing rewrites the file after it is gone.
  FTS5/embedding rows go by the same cascade once they exist.
- **Files** live in `POP_AGENT_DATA_DIR/files/` as a plain folder tree with real
  names (§14) — the disk is the record; there is no artifacts table. The only
  thing the database keeps is `file_provenance`: an append-only log of which
  chat wrote which path and when. It is history, not state — a later rename
  does not update it, and nothing breaks when it points at a name that moved.
  Deleting a chat leaves the user's files alone.
