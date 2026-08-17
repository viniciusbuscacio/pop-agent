-- The background distiller's memory (docs/specs/Spec-Pop-General.md §8, auto-skill fase c).
--
-- `skill_distillation` is a watermark per conversation, not a "done" flag. A
-- conversation the distiller has read and that the user then continues has to
-- come back to the queue -- with only the messages written since. A boolean
-- would either re-read the whole thing every time or never look again, and
-- both are wrong.
--
-- The mark advances on every outcome except a provider failure: a tainted
-- window, an answer with nothing in it and a skill actually written all move
-- it, so the queue drains by itself. An LLM error leaves it where it was, so
-- the next tick retries that conversation at no extra cost.
--
-- `distilled_at` doubles as the status line's clock: the newest row is when the
-- distiller last finished a conversation.
--
-- No foreign key to chats. The sweep in the distiller prunes rows whose chat is
-- gone, the same way the router prunes vectors -- and a stale row here is inert
-- anyway, because nothing joins to it.

CREATE TABLE skill_distillation (
  chat_id      TEXT PRIMARY KEY,
  message_id   TEXT NOT NULL,
  distilled_at TEXT NOT NULL
);

-- A proposed rewrite of a skill that already exists, held OUTSIDE the vault.
--
-- This is the other half of the approval promise. A new skill is protected by
-- being born pending, but without this table the update path would have no
-- review at all: an injection distilled as "a better version of a skill you
-- already approved" would overwrite a trusted skill in place. So a revision
-- waits here, and the version in the vault keeps serving the router until the
-- user accepts the new one.
--
-- One row per skill: a second proposal for the same skill replaces an
-- unreviewed first one rather than queueing behind it. A user who has not
-- looked yet is better served by the distiller's latest opinion than by a
-- backlog of three.
--
-- `similarity` is the cosine that made the distiller call this an update
-- instead of a new skill. Kept because the 0.90 threshold was chosen without
-- data (§10) and this column is the data that will retune it.

CREATE TABLE skill_revisions (
  slug        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL,
  when_to_use TEXT NOT NULL,
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  similarity  REAL NOT NULL
);
