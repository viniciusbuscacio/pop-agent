-- The ten most recently selected (provider, model) pairs. The adapter trims
-- this table on write, keeping the picker small without losing persistence.
CREATE TABLE recent_models (
  provider      TEXT NOT NULL,
  model         TEXT NOT NULL,
  used_at       TEXT NOT NULL,
  PRIMARY KEY (provider, model)
);

CREATE INDEX idx_recent_models_used_at ON recent_models(used_at DESC);
