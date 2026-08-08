-- Passkeys / WebAuthn credentials (pop-agent.spec §9).
--
-- One row per registered authenticator (a phone's Face ID, a security key).
-- The public key verifies each assertion; the counter guards against a cloned
-- credential replaying an old signature. There is one account, so no user id.

CREATE TABLE webauthn_credentials (
  id          TEXT PRIMARY KEY,   -- the credential id (base64url)
  public_key  BLOB NOT NULL,
  counter     INTEGER NOT NULL DEFAULT 0,
  transports  TEXT NOT NULL DEFAULT '',
  label       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL
);
