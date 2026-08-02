-- Nested folders + a Files search index (decision of 02/08).
--
-- Folders gain a parent, so a folder can hold folders as well as files. The old
-- model was flat with a global UNIQUE(name); nesting needs "unique among
-- siblings" instead, and the root (NULL parent) must still reject a duplicate
-- name. Dropping a column-level UNIQUE means rebuilding the table -- and folders
-- is referenced by artifacts.folder_id.
--
-- The trap: ALTER TABLE ... RENAME rewrites the child FK to follow the renamed
-- table, so the usual rename-copy-drop leaves artifacts pointing at the dropped
-- table (proven against the real db). Instead we build the new table under a
-- temp name, DROP the old folders, then RENAME the temp INTO `folders`: the
-- child FK text stays `REFERENCES folders`, which now resolves to the rebuilt
-- table. defer_foreign_keys tolerates the in-between window until COMMIT, where
-- every id lines up again (foreign_key_check verified clean).

PRAGMA defer_foreign_keys = ON;

CREATE TABLE folders_new (
  id          TEXT PRIMARY KEY,          -- folder-<11 base62>
  name        TEXT NOT NULL,
  parent_id   TEXT REFERENCES folders(id),  -- NULL = the root of Files
  created_at  TEXT NOT NULL
);

INSERT INTO folders_new (id, name, parent_id, created_at)
  SELECT id, name, NULL, created_at FROM folders;

DROP TABLE folders;
ALTER TABLE folders_new RENAME TO folders;

-- Unique among siblings; NULL parents (the root) fold to '' so two root folders
-- of the same name still collide, matching the old global behaviour there.
CREATE UNIQUE INDEX folders_sibling_name ON folders (COALESCE(parent_id, ''), name);
CREATE INDEX folders_by_parent ON folders (parent_id);

-- The Files search index: a materialised path for every folder and file, so a
-- search matches a name or any path segment anywhere in the tree, and folders
-- are found -- not only files. It is a cache, never a source of truth: rebuilt
-- whenever Files change, at boot, and once a day as a safety net.
CREATE TABLE path_index (
  kind       TEXT NOT NULL,             -- 'folder' | 'file'
  ref_id     TEXT NOT NULL,             -- folder id or artifact id
  name       TEXT NOT NULL,             -- display name
  path       TEXT NOT NULL,             -- 'Projetos/specs/popy.md'
  parent_id  TEXT,                      -- containing folder id (NULL = root)
  PRIMARY KEY (kind, ref_id)
);
CREATE INDEX path_index_name ON path_index (name);
