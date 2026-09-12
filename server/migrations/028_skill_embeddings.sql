-- Vectors for the skill router (docs/specs/Spec-Pop-General.md §8).
--
-- The router blends a lexical ranking with a semantic one, and the semantic
-- half needs a vector per skill. Computing those is cheap but not free: the
-- embedding model runs on the server's CPU, and before this table every
-- restart paid for the whole vault again on the first message of the session.
--
-- Keyed by slug, and stamped with `signature` -- the exact routing text
-- (name. description. whenToUse) the vector was computed from. That is what
-- makes invalidation honest: edit a skill's description and the signature no
-- longer matches, so the vector is recomputed; leave it alone and it is free
-- forever. No timestamp to reason about, no migration when the format changes.
--
-- No dimension column: the vector's byte length already says how long it is,
-- and the router discards any row whose length disagrees with the current
-- embedder -- which is what happens if the embedding model is ever swapped.
--
-- Not tied to the vault by a foreign key, because the vault is a folder of
-- markdown files, not a table. The router prunes the rows whose skill is gone
-- when it loads them.

CREATE TABLE skill_embeddings (
  slug      TEXT PRIMARY KEY,
  signature TEXT NOT NULL,
  vector    BLOB NOT NULL
);
