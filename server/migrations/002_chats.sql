-- Conversations and their messages (docs/specs/Spec-Pop-General.md §6).
--
-- Messages carry the assembled result of a run: the answer text, the thinking
-- that preceded it, and a JSON record of the tools that ran. Keeping those in
-- columns rather than a blob of events means the UI can render a reloaded
-- conversation exactly as it looked live, without replaying anything.
--
-- FTS5 and sqlite-vec are deliberately absent: search and memory arrive in a
-- later phase, and adding the tables early would mean maintaining triggers for
-- a feature nothing uses yet.

CREATE TABLE chats (
  id            TEXT PRIMARY KEY,
  title         TEXT    NOT NULL DEFAULT 'New chat',
  model         TEXT    NOT NULL DEFAULT '',
  archived      INTEGER NOT NULL DEFAULT 0,
  -- Path to pi's own JSONL session; empty until a real agent run happens.
  pi_session_id TEXT    NOT NULL DEFAULT '',
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL
);

CREATE TABLE messages (
  id               TEXT PRIMARY KEY,
  chat_id          TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  role             TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content          TEXT NOT NULL,
  thinking         TEXT NOT NULL DEFAULT '',
  tools_json       TEXT NOT NULL DEFAULT '[]',
  attachments_json TEXT NOT NULL DEFAULT '[]',
  created_at       TEXT NOT NULL
);

-- Every read is "the messages of one chat, in order", including the paginated
-- walk backwards through history.
CREATE INDEX idx_messages_chat ON messages(chat_id, created_at);
