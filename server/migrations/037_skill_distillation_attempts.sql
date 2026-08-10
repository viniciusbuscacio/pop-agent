-- Durable observability for the background skill distiller (pop-agent.spec §8).
--
-- `skill_distillation` remains the queue watermark. These rows are an immutable
-- account of each window the distiller tried to read, including failures (which
-- deliberately do not advance that watermark). A conversation may be read more
-- than once as it grows, so the unit is an attempt over a bounded message range,
-- not one status stamped on the chat forever.
--
-- No transcript, provider answer or suspicious source text is copied here.
-- Diagnostics are codes and measurements only, so observability does not become
-- a second store for private or hostile content.

CREATE TABLE skill_distillation_attempts (
  id                  TEXT PRIMARY KEY,
  chat_id             TEXT NOT NULL,
  chat_title          TEXT NOT NULL,
  from_message_id     TEXT,
  through_message_id  TEXT NOT NULL,
  trigger             TEXT NOT NULL CHECK (trigger IN ('automatic', 'explicit_request', 'manual_retry')),
  requested           INTEGER NOT NULL DEFAULT 0 CHECK (requested IN (0, 1)),
  state               TEXT NOT NULL CHECK (state IN ('queued', 'running', 'completed', 'failed')),
  outcome             TEXT CHECK (outcome IN ('produced', 'nothing', 'tainted', 'failed', 'invalid_output')),
  risk_level          TEXT CHECK (risk_level IN ('suspicious', 'high')),
  warnings_json       TEXT NOT NULL DEFAULT '[]',
  error_code          TEXT,
  error_message       TEXT,
  retry_of            TEXT REFERENCES skill_distillation_attempts(id) ON DELETE SET NULL,
  started_at          TEXT NOT NULL,
  finished_at         TEXT
);

CREATE INDEX skill_distillation_attempts_recent
  ON skill_distillation_attempts(started_at DESC, id DESC);
CREATE INDEX skill_distillation_attempts_chat
  ON skill_distillation_attempts(chat_id, started_at DESC);
CREATE INDEX skill_distillation_attempts_queue
  ON skill_distillation_attempts(state, started_at, id);

CREATE TABLE skill_distillation_results (
  attempt_id          TEXT NOT NULL REFERENCES skill_distillation_attempts(id) ON DELETE CASCADE,
  position            INTEGER NOT NULL,
  slug                TEXT NOT NULL,
  disposition         TEXT NOT NULL CHECK (disposition IN (
    'pending', 'live', 'revision', 'updated', 'rejected',
    'skipped_user', 'skipped_builtin', 'gone'
  )),
  target_slug         TEXT,
  reason              TEXT CHECK (reason IN ('slug_collision', 'dedup_match')),
  similarity          REAL,
  overlap             REAL,
  PRIMARY KEY (attempt_id, position)
);
