-- Background tasks (pop-agent.spec §21): a prompt the user schedules once or every
-- N minutes. Each due task opens a fresh conversation named after the task and
-- runs through the normal chat pipeline, so failover, compaction and error
-- persistence all apply and the result is readable as an ordinary chat.
--
-- Times are epoch milliseconds here (not the ISO strings the chat tables use):
-- everything about a schedule is arithmetic, and a number is what the clock
-- port already hands out.

CREATE TABLE tasks (
  id               TEXT PRIMARY KEY,          -- task-<11 base62>
  title            TEXT NOT NULL,             -- also the title of every chat it opens
  prompt           TEXT NOT NULL,
  schedule_kind    TEXT NOT NULL CHECK (schedule_kind IN ('once','interval')),
  interval_minutes INTEGER,                   -- only for 'interval'
  next_run_at      INTEGER,                   -- NULL = nothing scheduled
  enabled          INTEGER NOT NULL DEFAULT 1,
  created_at       INTEGER NOT NULL,
  last_run_at      INTEGER,
  last_status      TEXT,                      -- 'ok' or the failure code
  last_chat_id     TEXT                       -- the chat the last run wrote into
);

-- The scheduler's only hot query: what is due right now.
CREATE INDEX tasks_due ON tasks (enabled, next_run_at);
