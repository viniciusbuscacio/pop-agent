-- Lexical memory over every message ever written (popy.spec §7).
--
-- FTS5 external-content index over messages.content: the index stores only the
-- terms, the rows stay in messages. Triggers keep the two in sync, and the
-- backfill seeds it from whatever is already there so memory works on day one
-- of the upgrade, not only for messages written afterwards.

CREATE VIRTUAL TABLE messages_fts USING fts5(
  content,
  content='messages',
  content_rowid='rowid'
);

INSERT INTO messages_fts (rowid, content)
  SELECT rowid, content FROM messages;

CREATE TRIGGER messages_fts_insert AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts (rowid, content) VALUES (new.rowid, new.content);
END;

CREATE TRIGGER messages_fts_delete AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts (messages_fts, rowid, content)
    VALUES ('delete', old.rowid, old.content);
END;

CREATE TRIGGER messages_fts_update AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts (messages_fts, rowid, content)
    VALUES ('delete', old.rowid, old.content);
  INSERT INTO messages_fts (rowid, content) VALUES (new.rowid, new.content);
END;
