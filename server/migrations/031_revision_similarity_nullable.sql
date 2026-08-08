-- skill_revisions.similarity becomes nullable (pop-agent.spec §8, auto-skill).
--
-- The column exists to retune the dedup bars with real measurements, and a
-- revision proposed on a SLUG COLLISION used to carry a hardcoded 1 -- a
-- number that reads as a perfect semantic match in exactly the dataset that
-- must stay honest. The distiller now measures the real cosine when it can
-- and writes NULL when there was nothing to measure with (no embedder, or no
-- stored vector for the skill being replaced).
--
-- SQLite cannot alter a column, so the table is rebuilt. Existing rows keep
-- their numbers -- they are history, honest or not, and the install base is
-- dev-disposable.

CREATE TABLE skill_revisions_new (
  slug        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL,
  when_to_use TEXT NOT NULL,
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  similarity  REAL
);

INSERT INTO skill_revisions_new
  SELECT slug, name, description, when_to_use, body, created_at, similarity
    FROM skill_revisions;

DROP TABLE skill_revisions;
ALTER TABLE skill_revisions_new RENAME TO skill_revisions;
