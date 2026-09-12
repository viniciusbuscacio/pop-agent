-- Files with folders (decision of 31/07): the Artefacts tab becomes Files, a
-- flat folder tree the user manages. A file may now exist without a chat
-- (uploaded straight into Files), so chat_id becomes nullable -- which in
-- SQLite means rebuilding the table. ALTER TABLE RENAME keeps the FK clauses
-- of dependents pointing at the renamed table, so the versions table is
-- rebuilt alongside and the old pair is dropped only when nothing depends on
-- it. Bytes of chatless files live under artifacts/_files/.

CREATE TABLE folders (
  id          TEXT PRIMARY KEY,          -- folder-<11 base62>
  name        TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL
);

ALTER TABLE artifacts RENAME TO artifacts_old;
ALTER TABLE artifact_versions RENAME TO artifact_versions_old;

CREATE TABLE artifacts (
  id          TEXT PRIMARY KEY,          -- file-<11 base62>
  chat_id     TEXT REFERENCES chats(id) ON DELETE CASCADE,  -- NULL = no chat
  folder_id   TEXT REFERENCES folders(id),                   -- NULL = root
  name        TEXT NOT NULL,             -- original / display name
  mime        TEXT NOT NULL,
  size        INTEGER NOT NULL,
  version     INTEGER NOT NULL DEFAULT 1,
  source      TEXT NOT NULL,             -- 'agent' | 'upload'
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

INSERT INTO artifacts (id, chat_id, folder_id, name, mime, size, version, source, created_at, updated_at)
  SELECT id, chat_id, NULL, name, mime, size, version, source, created_at, updated_at
  FROM artifacts_old;

CREATE TABLE artifact_versions (
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  version     INTEGER NOT NULL,
  mime        TEXT NOT NULL,
  size        INTEGER NOT NULL,
  source      TEXT NOT NULL,             -- 'agent' | 'upload'
  created_at  TEXT NOT NULL,
  PRIMARY KEY (artifact_id, version)
);

INSERT INTO artifact_versions (artifact_id, version, mime, size, source, created_at)
  SELECT artifact_id, version, mime, size, source, created_at FROM artifact_versions_old;

DROP TABLE artifact_versions_old;
DROP TABLE artifacts_old;

CREATE INDEX artifacts_by_chat ON artifacts (chat_id, created_at);
CREATE INDEX artifacts_by_folder ON artifacts (folder_id, created_at);
