-- Artifact version history (docs/specs/Spec-Pop-General.md §14, RF-018/019). Changing an artifact
-- (re-uploading or the agent re-saving under the same name) keeps the previous
-- bytes as a numbered version instead of losing them. The artifacts row always
-- reflects the latest; this table is the trail (id, size, source, timestamp) --
-- the audit RF-019 asks for, on a single-user install where the user is implied.

CREATE TABLE artifact_versions (
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  version     INTEGER NOT NULL,
  mime        TEXT NOT NULL,
  size        INTEGER NOT NULL,
  source      TEXT NOT NULL,           -- 'agent' | 'upload'
  created_at  TEXT NOT NULL,
  PRIMARY KEY (artifact_id, version)
);

-- Every artifact that already exists is its own first version.
INSERT INTO artifact_versions (artifact_id, version, mime, size, source, created_at)
SELECT id, version, mime, size, source, created_at FROM artifacts;
