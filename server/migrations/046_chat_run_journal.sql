-- Durable ownership of admitted chat runs. A row exists from the atomic user-turn
-- admission until final product messages are committed. `queued` is safe to
-- resume; `running` may already have executed tools and is only interrupted.
CREATE TABLE chat_run_journal (
  run_id              TEXT PRIMARY KEY,
  chat_id             TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_message_id     TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  state               TEXT NOT NULL CHECK (state IN ('queued', 'running')),
  prompt              TEXT NOT NULL,
  model               TEXT NOT NULL,
  provider            TEXT NOT NULL,
  attachments_json    TEXT NOT NULL DEFAULT '[]',
  notify               INTEGER NOT NULL DEFAULT 1 CHECK (notify IN (0, 1)),
  local_connection_id TEXT,
  execution_mode      TEXT NOT NULL DEFAULT 'normal' CHECK (execution_mode IN ('normal', 'plan')),
  seq                  INTEGER NOT NULL DEFAULT 0,
  content              TEXT NOT NULL DEFAULT '',
  thinking             TEXT NOT NULL DEFAULT '',
  tools_json           TEXT NOT NULL DEFAULT '[]',
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  UNIQUE(chat_id)
);

CREATE INDEX chat_run_journal_state_created_idx
  ON chat_run_journal(state, created_at);
