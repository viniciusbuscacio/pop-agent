-- Per-run cost accounting (pop-agent.spec §6, §14; Phase 3 step 4).
--
-- One row per finished run, with the provider's own numbers -- the usage pi
-- reports, never an estimate. Deliberately no foreign key to chats: deleting
-- a conversation must not delete the record that it cost money.

CREATE TABLE llm_runs (
  id         TEXT PRIMARY KEY,          -- the run id (run- + 16 hex)
  chat_id    TEXT NOT NULL,
  provider   TEXT NOT NULL,
  model      TEXT NOT NULL,
  tokens_in  INTEGER NOT NULL,
  tokens_out INTEGER NOT NULL,
  cost       REAL NOT NULL,             -- US dollars
  created_at TEXT NOT NULL
);

-- The dashboard of v0.2 reads "what did this period cost", newest first.
CREATE INDEX idx_llm_runs_created ON llm_runs(created_at);
