-- Remember what the official SDK negotiated so the MCP screen distinguishes
-- modern stateless servers from legacy initialize/session servers.
ALTER TABLE mcp_servers ADD COLUMN protocol_era TEXT
  CHECK (protocol_era IN ('modern', 'legacy'));
ALTER TABLE mcp_servers ADD COLUMN protocol_version TEXT;
