-- Settings and secrets (popy.spec §6, §9).
--
-- settings.value holds JSON so a key can carry any shape without a schema
-- change. secrets.value_encrypted is sealed with AES-256-GCM using the key in
-- POPY_DATA_DIR/secret.key (layout: nonce || ciphertext || tag). The database
-- file itself is deliberately not encrypted -- see popy.spec §9 for the threat
-- model and why the key file is excluded from backups.

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE secrets (
  key             TEXT PRIMARY KEY,
  value_encrypted BLOB NOT NULL
);
