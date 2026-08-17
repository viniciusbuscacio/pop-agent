-- Artifacts: files the agent produces (or the user uploads), tracked per chat
-- and downloadable through a signed link (docs/specs/Spec-Pop-General.md §6, §14). The bytes live on
-- disk under POP_AGENT_DATA_DIR/artifacts/<chat_id>/<id>; this row is the record.
-- The id is the only identifier that ever leaves the server: no filesystem path
-- or storage key is exposed.

CREATE TABLE artifacts (
  id          TEXT PRIMARY KEY,          -- file-<11 base62>
  chat_id     TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,             -- original / display name
  mime        TEXT NOT NULL,
  size        INTEGER NOT NULL,
  version     INTEGER NOT NULL DEFAULT 1,
  source      TEXT NOT NULL,             -- 'agent' | 'upload'
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX artifacts_by_chat ON artifacts (chat_id, created_at);
