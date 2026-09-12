CREATE TABLE mcp_servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  transport TEXT NOT NULL CHECK (transport IN ('stdio','sse','streamable-http')),
  endpoint TEXT NOT NULL DEFAULT '',
  command TEXT NOT NULL DEFAULT '',
  args_json TEXT NOT NULL DEFAULT '[]',
  auth_kind TEXT NOT NULL CHECK (auth_kind IN ('none','bearer','api-key','custom-header')),
  auth_header TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  timeout_ms INTEGER NOT NULL DEFAULT 60000,
  status TEXT NOT NULL DEFAULT 'unknown',
  last_error TEXT NOT NULL DEFAULT '',
  last_connected_at TEXT,
  cwd TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE mcp_capabilities (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('tool','resource','prompt')),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  input_schema_json TEXT NOT NULL DEFAULT '{}',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,
  UNIQUE(server_id, kind, name)
);

CREATE INDEX mcp_capabilities_server_idx ON mcp_capabilities(server_id);
CREATE INDEX mcp_servers_enabled_idx ON mcp_servers(enabled);
