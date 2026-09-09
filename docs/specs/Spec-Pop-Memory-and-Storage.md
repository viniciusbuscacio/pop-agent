# Pop Agent — memory and storage

**Status:** normative

Settings Memory writes may carry `expectedDoc` for compare-and-write protection.
When present, the HTTP adapter compares it to the current document immediately
before the synchronous write, without an intervening await; mismatch returns
409 `edit_conflict` without modifying the document or backup. Legacy clients
without this field retain their existing contract. The PWA always supplies the
loaded/reviewed base and preserves drafts on conflict.
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

Pi owns the native compaction policy, thresholds and recent tail. Pop inherits
the active pi defaults without restating their values. A native refusal such as
"session too small" is accepted; Pop does not force a different compaction decision. Pi cuts at
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

## Backup password, creation and retention

Settings → Backup stores one independent backup password (10–128 characters),
confirmed by the owner and encrypted through SecretsRepo as
`backup.archive-password`. It is never returned by the API. The UI supports
Save and Cancel, shows only whether a password exists, and clears password
fields after saving/cancelling. This is not the app password or recovery key.
Keep the password outside Pop: restore requires the password used for that
archive. A password change affects only new archives.

Settings and `popman backup` reuse the saved password. Creation refuses to run
without one; there is no plaintext fallback. Operator schedulers can invoke
`popman backup` noninteractively after password setup. A built-in scheduling UI
is not included in this change. Retention keeps the ten newest completed
archives, including legacy archives.

New files end in `.popbackup`. Format v1 is `POPBAK01` (8 bytes), random salt
(16), random nonce (12), AES-256-GCM ciphertext, and authentication tag (16).
The entire header is authenticated as AAD. The 32-byte key uses async scrypt
with fixed N=32768, r=8, p=1 and maxmem=64 MiB. Each archive gets new randomness;
archive bytes cannot select KDF parameters. Compression precedes encryption.
The implementation uses Node crypto and the pinned tar package, not shell
arguments containing passwords. No plaintext tar.gz is written during creation.

Creation copies non-database data into private staging, excludes `secret.key`
and live DB/WAL/SHM, and uses SQLite's online backup API for a consistent database
snapshot including committed WAL records. The compressed stream is encrypted
with backpressure into a private pending file and renamed only after completion.
Staging is removed in finally; failed creations are not listed or pruned as
completed backups. The private snapshot staging is plaintext, like live data;
this feature encrypts exported archives, not the server filesystem.

Archive contents include conversations, files, notes, sessions and pi-managed
provider sign-in tokens. The saved backup password may exist inside the SQLite
snapshot only as SecretsRepo ciphertext; `secret.key` remains excluded.
Legacy `.tar.gz` archives remain unencrypted, downloadable and restorable, with
an explicit label in the UI. New encryption does not rewrite old archives.

Downloadable `models/` (embedding weights) and `voice-models/` (Whisper weights)
are excluded from new backups. They are not owner content. Browser restoration
reuses existing host caches; a new host downloads them on demand. User files,
conversation sessions, skills, settings, credentials and required pi runtime
state remain included. Older archives containing model caches remain readable.

Settings → Backup includes an enabled-by-default **Include files** switch per
creation. Disabling it omits only the root `files/` tree, including file bytes
used by attachments; conversation records, sessions, settings, skills and notes
remain included. Every new archive contains authenticated content metadata.
Restoring an archive without Files preserves the destination host's existing
Files tree; on a fresh host it stays empty. A missing manifest identifies older
complete backups. Restore policy comes from validated archive metadata, never
from a caller-supplied filename. Listings label locally-created omissions as
Without Files using their generated `-without-files.popbackup` suffix.

## Browser and offline restore

Settings → Backup offers Restore for each saved archive on the installed systemd
service. The owner confirms replacement and supplies that archive's password.
HTTP accepts the operation (202) and prepares a validated snapshot in a private
sibling directory. It never replaces data beneath live repositories. On success,
the process exits for systemd restart; cold boot installs the prepared directory
**before** bootstrap opens SQLite or starts any jobs. The previous directory is
retained beside the data root as `.before-restore-<id>` for operator recovery;
these recovery directories require manual cleanup and are not part of the ten
archive retention limit. The UI warns about data replacement, interrupted runs
and signing in again with the credentials from the snapshot.

The rename journal resumes interruption between moving the old directory and
installing the staged directory. An incomplete preparation is discarded. Failed
installation restores the old directory before bootstrap; failure to roll back
must fail startup closed. Browser restore replaces the complete snapshot rather
than retaining newer files through an overlay. The same authenticated archive
validation and host-key handling are shared with operator restore.

GET `/v1/backups` exposes operation state without secrets. The screen polls every
ten seconds, so leaving and returning does not lose the state of backup creation
or restore preparation. Both run server-side; creation and preparation require
the server to remain running. Conflicting backup mutations are rejected.

`popman restore <exact-backup-name>` asks
for the archive password with terminal echo disabled for `.popbackup` files.
It does not retrieve a saved password as a shortcut: older archives may need an
older password. No password is passed via argv or environment. Missing input
cancels before stopping the service.

The manager does not bootstrap/open the application database for restore.
It stops the service before restoration and restarts in finally, reporting
failure if either operation fails. Decryption writes only into private staging;
GCM authentication must complete before parsing/extracting any archive. Wrong
passwords, truncation and tampering never alter live data.

Validate archive paths, link destinations and entry types, reject host-key and
WAL/SHM entries, extract in isolation, and verify the SQLite snapshot before
copying into the stopped data directory. Restore retains legacy overlay
semantics; it is not a crash-atomic filesystem transaction. Storage failures
during the final copy require operator recovery from the original archive.
The existing host key is preserved. On a new/different host, unreadable
SecretsRepo values are cleared and session-signing material is recreated under
the destination key; the app login hash and private content are retained.
SecretsRepo integrations then require credential re-entry. The supplied backup
password is re-saved under the destination key for future backups.

## Failure and test obligations

- lexical memory works while embedding is unavailable;
- indexing failure never loses the durable message;
- malformed/escaped note and Files paths fail closed;
- secret-shaped memory content is scrubbed through every write surface;
- backup tests prove committed WAL rows are present without WAL/SHM sidecars;
- browser restore validates confirmation, stages without live replacement, and installs only at cold boot;
- invalid passwords, interrupted preparation and interrupted directory swaps preserve recoverable data;
- operator restore proves stop → extract → start ordering;
- backup archives exclude the encryption key and their own staging/backups;
- storage totals avoid double counting and include external backup bytes.

The full repository gate must pass after any schema, storage, backup or restore
change.
