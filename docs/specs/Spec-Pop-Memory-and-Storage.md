# Pop Agent — Memory and storage

**Status:** current architecture explanation
**Normative source:** `pop-agent.spec` §§4, 6, 7, 11, 14 and 16
**Primary code:** `server/src/application/memory`, `server/src/infrastructure/db`, `server/src/infrastructure/files`, `server/src/infrastructure/notes`, `server/src/infrastructure/backup`

## Runtime roots

`POP_AGENT_DATA_DIR` owns durable installation data: SQLite, encrypted-secret support files, pi sessions, Files, Notes, Skills, attachments and backups. `POP_AGENT_WORKSPACE` is the agent's working root. A controlled link exposes the same Files tree to tools and the Files tab.

Do not confuse repository source, workspace scratch data and user Files.

## SQLite

A single SQLite database stores product state. Numbered migrations run at boot. WAL supports the single-user server's concurrent read/write pattern. Repositories hide SQL behind application ports.

Major state includes chats/messages, queues, settings, encrypted secrets, usage, memory indexes, tasks, skill metadata and provenance. The current migration set—not an old schema example—is implementation truth.

## pi sessions

pi JSONL files belong to pi and represent execution context. Pop stores their paths but does not parse them as its product database. Product messages intentionally coexist in SQLite.

## Files

Files is a plain folder tree with real user-visible names. The Files tab and agent tools operate on the same bytes. Services enforce path jail, upload limits, safe rename/delete and restorable trash. Deletion inside the user's Files must use the trash mechanism, not destructive unlink.

File search and indexing are derived capabilities; the filesystem remains the record of existence.

## Notes

Notes is Pop Agent's private Markdown vault under the data directory. It is separate from Files and from the maintainer's external Obsidian vault. Note tools enforce vault-relative `.md` paths and append rather than read-concatenate-rewrite when adding content.

## Conversation memory

Message search uses lexical and semantic retrieval over persisted conversations. `memory_search`, `memory_open` and recent catalogs recover past context without injecting all history. A living user-memory document carries durable preferences/project context and keeps a one-level backup.

External/retrieved text is data, not authority.

## Embeddings

Local embeddings support memory, files and skill routing. Vectors are stored as blobs and validated against expected dimensions/signatures. Indexing is asynchronous where request latency should not depend on extraction or embedding.

## Backup

Backups snapshot durable product data while excluding the local encryption key and avoiding recursive inclusion of backup archives. Restore must preserve permissions, schema compatibility and rollback safety. User data is preserved by default during software removal.

## Change checklist

For storage changes, define ownership, path jail, migration, transaction, indexing/backfill, deletion cascade, backup inclusion, restore behavior, size bounds and interrupted-operation recovery. Test with temporary data directories and real filesystem edge cases.
