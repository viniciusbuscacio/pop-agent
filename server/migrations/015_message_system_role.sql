-- A failed run must leave a mark in the history (pop-agent.spec §6): every run
-- error is persisted as a `system` message, so it survives a reload and is
-- never erased by later turns. The original CHECK only allowed
-- user/assistant, and SQLite cannot alter a CHECK in place -- the table is
-- rebuilt with rowids preserved, so the FTS5 external-content index and the
-- embedding rows (keyed by rowid) stay valid. The FTS triggers ride along
-- because dropping the old table drops them.

CREATE TABLE messages_new (
  id               TEXT PRIMARY KEY,
  chat_id          TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  role             TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content          TEXT NOT NULL,
  thinking         TEXT NOT NULL DEFAULT '',
  tools_json       TEXT NOT NULL DEFAULT '[]',
  attachments_json TEXT NOT NULL DEFAULT '[]',
  created_at       TEXT NOT NULL
);

INSERT INTO messages_new (rowid, id, chat_id, role, content, thinking, tools_json, attachments_json, created_at)
  SELECT rowid, id, chat_id, role, content, thinking, tools_json, attachments_json, created_at FROM messages;

DROP TABLE messages;

ALTER TABLE messages_new RENAME TO messages;

CREATE INDEX idx_messages_chat ON messages(chat_id, created_at);

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
