-- How often each skill actually earns its slot (popy.spec §8, §6 do plano).
--
-- The router writes here every time it injects a skill. The counter is what
-- the garbage collector will read when there are more auto-skills than the cap
-- allows: archive the least used, never delete. That is why it is a counter and
-- a timestamp rather than a boolean "used" -- a skill used twice a year (the
-- annual tax procedure) has to be distinguishable from one used never, and a
-- fixed "90 days idle" rule would kill both.
--
-- Separate from skill_embeddings on purpose. That table is a cache: it gets
-- cleared wholesale when the embedding model changes. Usage history is earned
-- and must survive that.
--
-- No foreign key, for the same reason as the vectors: skills are markdown files
-- in a folder, not rows. A row for a skill that no longer exists is harmless
-- (nothing joins to it) and the GC prunes it when it runs.

CREATE TABLE skill_usage (
  slug         TEXT PRIMARY KEY,
  use_count    INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT NOT NULL
);
