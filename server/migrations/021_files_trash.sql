-- A trash for Files (decision of 03/08): deleting is reversible for 30 days.
--
-- Soft delete, never a move. The bytes stay exactly where they are, under the
-- same id: moving them into a trash/ directory would double the number of
-- paths one file can live at, and a crash halfway through would leave an
-- orphan nobody can find. A timestamp is the whole mechanism, and the sweeper
-- that empties the trash reads it.

ALTER TABLE artifacts ADD COLUMN deleted_at TEXT;
ALTER TABLE folders   ADD COLUMN deleted_at TEXT;

-- Partial: the live rows are the overwhelming majority and are found through
-- the NULL side of the listing queries, so only the trashed ones need an index
-- of their own -- which is also what the sweeper scans.
CREATE INDEX artifacts_trashed ON artifacts (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX folders_trashed   ON folders   (deleted_at) WHERE deleted_at IS NOT NULL;

-- "Unique among siblings" has to stop applying to the trash, or a folder in the
-- bin would block you from creating another one with the same name -- the bin
-- reaching out to forbid something in the live tree, which is indefensible.
-- A partial unique index says the same rule about the living rows only.
DROP INDEX folders_sibling_name;
CREATE UNIQUE INDEX folders_sibling_name
  ON folders (COALESCE(parent_id, ''), name)
  WHERE deleted_at IS NULL;
