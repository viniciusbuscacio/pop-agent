-- Durable user Files survive chat deletion; intentionally no cascading chat FK.
CREATE TABLE attachment_catalog (
  path TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  subject TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL,
  search_text TEXT NOT NULL
);
CREATE INDEX attachment_catalog_date ON attachment_catalog(created_at DESC);
