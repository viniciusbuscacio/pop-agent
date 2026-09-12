-- One durable follow-up per conversation. The row is the queue: the chat id is
-- unique, deletion of the chat deletes its unsent follow-up, and JSON keeps the
-- attachment wire shape lossless until the current answer finishes.
CREATE TABLE queued_messages (
  id               TEXT PRIMARY KEY,
  chat_id          TEXT NOT NULL UNIQUE REFERENCES chats(id) ON DELETE CASCADE,
  text             TEXT NOT NULL,
  attachments_json TEXT NOT NULL DEFAULT '[]',
  file_paths_json  TEXT NOT NULL DEFAULT '[]',
  client_json      TEXT,
  hands_connection_id TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
