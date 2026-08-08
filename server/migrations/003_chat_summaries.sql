-- Auto-titles and summaries (pop-agent.spec §14, Phase 3 step 3).
--
-- summary is written by the service model alongside the title; the memory of
-- Phase 4 reads it. auto_title records whether Pop Agent may keep renaming this
-- chat: a manual rename sets it to 0 and the machine stays out of the way.

ALTER TABLE chats ADD COLUMN summary TEXT NOT NULL DEFAULT '';
ALTER TABLE chats ADD COLUMN auto_title INTEGER NOT NULL DEFAULT 1;
