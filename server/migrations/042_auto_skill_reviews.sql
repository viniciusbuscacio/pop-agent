-- Automatic Auto-Skill review replaces the human approval inbox.
-- Preserve attempt history while widening result states and recording stable reason codes.

ALTER TABLE skill_distillation_results RENAME TO skill_distillation_results_old;

CREATE TABLE skill_distillation_results (
  attempt_id          TEXT NOT NULL REFERENCES skill_distillation_attempts(id) ON DELETE CASCADE,
  position            INTEGER NOT NULL,
  slug                TEXT NOT NULL,
  disposition         TEXT NOT NULL CHECK (disposition IN (
    'published_new', 'published_revision', 'policy_rejected', 'contract_rejected',
    'evidence_rejected', 'review_rejected', 'protected_duplicate', 'rejected'
  )),
  target_slug         TEXT,
  reason              TEXT CHECK (reason IN ('slug_collision', 'dedup_match')),
  similarity          REAL,
  overlap             REAL,
  policy_reasons_json TEXT NOT NULL DEFAULT '[]',
  review_reasons_json TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (attempt_id, position)
);

-- Keep legacy observability while translating its retired workflow vocabulary.
INSERT INTO skill_distillation_results
  (attempt_id, position, slug, disposition, target_slug, reason, similarity, overlap)
SELECT attempt_id, position, slug,
  CASE disposition
    WHEN 'pending' THEN 'published_new'
    WHEN 'live' THEN 'published_new'
    WHEN 'revision' THEN 'published_revision'
    WHEN 'updated' THEN 'published_revision'
    WHEN 'skipped_user' THEN 'protected_duplicate'
    WHEN 'skipped_builtin' THEN 'protected_duplicate'
    ELSE 'rejected'
  END,
  target_slug, reason, similarity, overlap
FROM skill_distillation_results_old;

DROP TABLE skill_distillation_results_old;

ALTER TABLE llm_runs ADD COLUMN purpose TEXT;

CREATE TABLE auto_skill_publications (
  id             TEXT PRIMARY KEY,
  slug           TEXT NOT NULL,
  action         TEXT NOT NULL CHECK (action IN ('new', 'revision')),
  review_hash    TEXT NOT NULL,
  temp_path      TEXT NOT NULL,
  destination   TEXT NOT NULL,
  backup_path    TEXT,
  state          TEXT NOT NULL CHECK (state IN ('prepared', 'committed')),
  prepared_at    TEXT NOT NULL,
  committed_at   TEXT
);
