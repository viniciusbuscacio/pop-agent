ALTER TABLE a2a_agents ADD COLUMN agent_card_path TEXT NOT NULL DEFAULT '.well-known/agent-card.json';
ALTER TABLE a2a_agents ADD COLUMN auth_provider TEXT NOT NULL DEFAULT 'static'
  CHECK (auth_provider IN ('static','microsoft-entra'));
ALTER TABLE a2a_agents ADD COLUMN entra_tenant_id TEXT NOT NULL DEFAULT '';
ALTER TABLE a2a_agents ADD COLUMN entra_client_id TEXT NOT NULL DEFAULT '';
ALTER TABLE a2a_agents ADD COLUMN entra_scope TEXT NOT NULL DEFAULT '';
