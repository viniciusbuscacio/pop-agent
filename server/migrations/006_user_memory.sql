-- The living user-memory document (pop-agent.spec §7, §6).
--
-- One row, ever: a single markdown document the agent keeps about the user,
-- plus a one-level backup so a bad edit (or an over-eager condensation) can be
-- undone. It starts empty -- Pop Agent learns the user, it does not assume them.

CREATE TABLE user_memory (
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  doc              TEXT NOT NULL DEFAULT '',
  backup           TEXT NOT NULL DEFAULT '',
  last_condensed_at TEXT NOT NULL DEFAULT ''
);

INSERT INTO user_memory (id, doc, backup, last_condensed_at) VALUES (1, '', '', '');
