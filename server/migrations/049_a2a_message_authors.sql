ALTER TABLE a2a_tasks ADD COLUMN request_messages_json TEXT NOT NULL DEFAULT '[]';

CREATE TABLE a2a_inbound_tasks (
  id TEXT PRIMARY KEY, message_id TEXT NOT NULL UNIQUE, context_id TEXT NOT NULL,
  chat_id TEXT NOT NULL, run_id TEXT NOT NULL, digest TEXT NOT NULL,
  created_at TEXT NOT NULL, state TEXT NOT NULL,
  response_text TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX idx_a2a_inbound_context ON a2a_inbound_tasks(context_id);
CREATE INDEX idx_a2a_inbound_run ON a2a_inbound_tasks(run_id);
