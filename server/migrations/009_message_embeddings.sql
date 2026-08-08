-- Semantic memory: one embedding per message (pop-agent.spec §7).
--
-- The vector is a Float32Array stored as a BLOB, keyed by the message's rowid
-- so the FTS join and the vector search line up. Search is a brute-force cosine
-- over these in JS -- a single-user server has thousands of messages, not
-- millions, and that is milliseconds. sqlite-vec was the alternative; the BLOB
-- keeps the build free of a native extension.
--
-- No foreign key: SQLite cannot reference the implicit rowid. A trigger drops
-- the embedding when its message goes (which is how a deleted chat's rows go),
-- exactly as the FTS index is kept in sync.
--
-- Rows are filled in the background as messages arrive and on a boot backfill,
-- so this table trails messages by moments and a search falls back to lexical
-- for anything not embedded yet.

CREATE TABLE message_embeddings (
  message_rowid INTEGER PRIMARY KEY,
  vector        BLOB NOT NULL
);

CREATE TRIGGER message_embeddings_delete AFTER DELETE ON messages BEGIN
  DELETE FROM message_embeddings WHERE message_rowid = old.rowid;
END;
