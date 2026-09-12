-- Replace the former one-slot queue with a durable FIFO. The application keeps
-- a high defensive cap, but SQLite no longer restricts a chat to one pending
-- input. Existing rows retain their ids and timestamps.
CREATE TABLE queued_messages_fifo (
  id                  TEXT PRIMARY KEY,
  chat_id             TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  text                TEXT NOT NULL,
  attachments_json    TEXT NOT NULL DEFAULT '[]',
  file_paths_json     TEXT NOT NULL DEFAULT '[]',
  client_json         TEXT,
  hands_connection_id TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  delivery_mode       TEXT NOT NULL DEFAULT 'steer'
    CHECK (delivery_mode IN ('steer', 'follow_up'))
);

INSERT INTO queued_messages_fifo
  (id, chat_id, text, attachments_json, file_paths_json, client_json,
   hands_connection_id, created_at, updated_at, delivery_mode)
SELECT
  id, chat_id, text, attachments_json, file_paths_json, client_json,
  hands_connection_id, created_at, updated_at, delivery_mode
FROM queued_messages;

DROP TABLE queued_messages;
ALTER TABLE queued_messages_fifo RENAME TO queued_messages;
CREATE INDEX queued_messages_chat_fifo
  ON queued_messages(chat_id, created_at);
