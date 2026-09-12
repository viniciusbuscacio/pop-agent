CREATE TABLE integration_tokens (id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, metadata TEXT NOT NULL);
CREATE TABLE integration_requests (token_id TEXT NOT NULL, request_key TEXT NOT NULL, payload_hash TEXT NOT NULL, response TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(token_id, request_key));
CREATE TABLE integration_activity (run_id TEXT PRIMARY KEY, snapshot TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE integration_events (cursor INTEGER PRIMARY KEY AUTOINCREMENT, snapshot TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE integration_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, token_id TEXT NOT NULL, operation TEXT NOT NULL, target TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX integration_requests_age ON integration_requests(created_at);
CREATE INDEX integration_activity_age ON integration_activity(updated_at);
CREATE TABLE rest_clients (id TEXT PRIMARY KEY, metadata TEXT NOT NULL);
