-- Structured system notices let clients render provider fallback details and
-- actions without parsing the human-readable history text. Older rows and
-- ordinary messages keep the empty object.
ALTER TABLE messages ADD COLUMN notice_json TEXT NOT NULL DEFAULT '{}';
