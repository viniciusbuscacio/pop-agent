-- Two per-task switches (pop-agent.spec §21).
--
-- `notify_on_finish` defaults to 1 because that is what every task did before
-- this column existed, and a task the user asked for is news. It exists at all
-- because a task on a ten-minute interval is a phone buzzing every ten
-- minutes, which is how a useful schedule gets switched off entirely.
--
-- `archive_chat` defaults to 0: filing a conversation the moment it is written
-- is a choice, not a default. When it is on, the run's chat is archived as
-- soon as the run ends -- still there, still linked from the task's last
-- status, just out of the sidebar.

ALTER TABLE tasks ADD COLUMN notify_on_finish INTEGER NOT NULL DEFAULT 1;
ALTER TABLE tasks ADD COLUMN archive_chat     INTEGER NOT NULL DEFAULT 0;
