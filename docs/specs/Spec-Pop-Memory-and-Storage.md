# Pop Agent — memory and storage

**Status:** normative
**Legacy coverage:** §§7, 11, 14 and 16
**Primary implementation:** `server/src/application/{memory,files,storage}/`, `server/src/infrastructure/{db,memory,notes,files,backup}/`
**Related:** [`Spec-Pop-Backend.md`](Spec-Pop-Backend.md), [`Spec-Pop-Pi-Agent-Integration.md`](Spec-Pop-Pi-Agent-Integration.md), [`Spec-Pop-Security.md`](Spec-Pop-Security.md)

## Storage authority and layout

SQLite plus the server data directory are durable product authority. Browser
storage is only a cache. The workspace is operational scratch and the `Files/`
subdirectory is the user-visible Files tab; these are not interchangeable.

Canonical locations are derived from configured data/workspace roots:

- `POP_AGENT_DATA_DIR/pop-agent.db`: product database;
- `POP_AGENT_DATA_DIR/secret.key`: encryption key, owner-only and never backed up;
- `POP_AGENT_DATA_DIR/notes/`: agent notes;
- `POP_AGENT_DATA_DIR/skills/`: skills;
- `POP_AGENT_DATA_DIR/sessions/`: pi JSONL session state;
- `POP_AGENT_WORKSPACE/Files/`: user files;
- `POP_AGENT_WORKSPACE/attachments/`: accepted chat attachments;
- sibling `pop-backups/`: backup archives, outside their own source tree.

The database runs WAL with foreign keys enabled. Numbered migrations are the
schema authority and run transactionally before repositories serve traffic.
Migration failure is fatal; code must not guess around a partially upgraded
schema.

## Conversation history and search memory

SQLite owns chats, ordered messages, queue items, run projections and archived
state. Pi JSONL owns engine/session continuation, not product history. Product
messages are persisted independently so a missing/corrupt pi session does not
erase the transcript.

The agent's history tools are:

- `memory_search(query)`: hybrid search grouped by conversation, at most three
  snippets per hit and a bounded chat count;
- `memory_open(chatId)`: bounded transcript window;
- `memory_recent()`: bounded recent chat catalog and summaries.

All returned historical text is sanitized and wrapped as untrusted data. A
compact recent catalog is included in session context so the agent knows what
can be opened without receiving every transcript.

Search combines FTS5 lexical rows and optional semantic cosine ranking through
shared reciprocal-rank fusion. Semantic absence/failure degrades to FTS; it
must not make memory unavailable. Message embeddings are written after durable
message persistence and backfilled in bounded batches. Deleting a message also
removes dependent embedding/index state through schema/repository invariants.

## Living user document

The living user document is one Markdown record for durable preferences,
projects and response style. It ships empty, is editable in Settings and is
available through `memory_user_read` / `memory_user_update`.

The document is capped at 8,000 characters in API, tool and prompt paths. Every
write keeps one previous version for immediate restore. Both direct Settings
edits and agent-tool writes pass through deterministic credential scrubbing
before persistence; labeled secrets, known token shapes and private-key blocks
are replaced rather than retained. Secret storage belongs to encrypted provider
settings, never memory.

The complete document enters the session instruction block. Changes therefore
invalidate captured pi context. No automatic LLM condensation job is currently
shipped; the hard cap and owner/agent replacement flow are the delivered bound.
A future condenser must be at most daily, keep the one-level backup, scrub again
and use an isolated service completion.

## Long-chat compaction and continuity

Pi's explicit native compaction policy triggers before a turn near the model
window, reserves 16,384 tokens and keeps a 20,000-token recent tail. Pi cuts at
valid turn/tool boundaries and persists compaction entries in its JSONL.

On a provider context-overflow refusal, Pop rewinds the rejected branch,
requests one compaction and retries the identical turn once. A second overflow
is terminal. Model-generated summaries remain conversation context, never
system authority.

After restart or idle unload, pi resumes its JSONL and Pop adds an untrusted
continuity note with the real stored-message count, memory paging instructions
and a requirement to rerun tools whose old results may no longer be present.
The agent must search before claiming it has no memory.

## Files awareness and durable files

The session instruction block contains a bounded, newest-first catalog of file
names/folders inside an untrusted envelope. Content is not injected eagerly.
Unknown names/projects trigger `files_search` and memory search before web
research. Content enters through attachment, mention or explicit tool read.

Files routes and tools enforce safe relative paths and server-side root jails.
Downloads use validated file identities/paths. Deletion inside `Files/` moves
entries to a recoverable trash; agents must use `delete_file`, never shell `rm`.
Folder deletion reports the full subtree blast radius to owner-facing
confirmation. Restore refuses name collisions rather than overwriting.

Accepted chat attachments are copied to chat-scoped workspace paths with
sanitized names. Provenance tracks durable user files derived from tools or
session exports. A database reference is not proof that a filesystem path still
exists; missing files return an explicit not-found outcome.

## Notes vault

Notes are plain Markdown under `POP_AGENT_DATA_DIR/notes/` and may be opened by
Obsidian or external sync, but Pop provides no privileged external-vault bridge.
Tools include list, bounded read, bounded substring search, full replace and
append.

Every note path passes through a real-path jail. Absolute paths, traversal and
symlink escapes are refused. Hidden entries are excluded from listing. Reads
are capped at 64 KiB, lists at 500 notes and search at 20 hits with bounded line
snippets.

`notes_append` writes directly to the file end, creates missing notes and adds a
separator newline when needed. It must never be implemented as capped
read–concatenate–replace because that would truncate a large note.

Note content returned to the model is external untrusted data. Notes and memory
must never be used to retain passwords, tokens or private keys.

## Storage accounting

Settings → Storage reports what Pop Agent is responsible for:

- Files bytes/count;
- search-index logical contribution;
- database plus WAL/SHM bytes;
- downloaded model weights;
- workspace bytes/count;
- notes/skills/sessions and other data;
- backups outside the data directory;
- filesystem free/total capacity when available.

Physical totals must not double-count the logical search index already inside
SQLite. Measurements are observational and may change during the scan; totals
must never become negative. Model weights stay visible as a separate category
because they commonly dominate disk use.

## Backup creation and retention

Settings and `popman backup` create an on-demand `tar.gz` snapshot. The shipped
retention policy keeps the ten newest archives. Pop currently does not claim a
built-in automatic daily/weekly scheduler; an operator scheduler must invoke the
same snapshot implementation rather than copying files itself.

Creation uses a private staging directory:

1. copy non-database data while excluding `secret.key` and live DB/WAL/SHM;
2. create `pop-agent.db` through SQLite's online backup API, which includes
   committed WAL content as one consistent database image without blocking the
   Node event loop;
3. archive the staged tree;
4. delete staging in `finally` and prune only completed archives.

Backups are data-sensitive even without the key: they contain conversations,
files, notes and metadata. Excluding `secret.key` means encrypted provider
credentials and session signing material cannot be decrypted from the archive
alone; it does not make all backup content public-safe. A new host requires
re-entering credentials.

Archive names are generated server-side and path-validated for listing,
download and deletion. A failed snapshot must not replace a previous archive or
leave staging as a visible backup.

## Offline restore

Restore is forbidden through the live HTTP process. Replacing SQLite while
repositories hold it open can combine restored disk state with old process
state.

The operator command is:

```text
popman restore <exact-backup-name>
```

It stops `pop-agent-service`, extracts the selected known archive, and starts
the service in `finally`, including when the archive name is invalid. Failure to
stop prevents extraction; failure to restart is reported as failure. The key is
not in the archive and the existing host key is left in place.

Restore does not silently migrate or validate with a running server. Normal boot
then opens the restored database, runs any newer migrations and performs other
boot reconciliation. Cross-version restoration must be tested against the
oldest supported backup.

## Failure and test obligations

- lexical memory works while embedding is unavailable;
- indexing failure never loses the durable message;
- malformed/escaped note and Files paths fail closed;
- secret-shaped memory content is scrubbed through every write surface;
- backup tests prove committed WAL rows are present without WAL/SHM sidecars;
- live HTTP restore returns a conflict and performs no extraction;
- operator restore proves stop → extract → start ordering;
- backup archives exclude the encryption key and their own staging/backups;
- storage totals avoid double counting and include external backup bytes.

The full repository gate must pass after any schema, storage, backup or restore
change.
