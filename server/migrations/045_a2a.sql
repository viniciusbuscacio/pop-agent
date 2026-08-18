CREATE TABLE a2a_agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  base_url TEXT NOT NULL,
  auth_kind TEXT NOT NULL CHECK (auth_kind IN ('none','bearer','api-key','custom-header')),
  auth_header TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  timeout_ms INTEGER NOT NULL DEFAULT 60000,
  status TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN ('unknown','connected','error')),
  last_error TEXT NOT NULL DEFAULT '',
  last_connected_at TEXT,
  protocol_version TEXT NOT NULL DEFAULT '',
  agent_version TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE a2a_interfaces (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES a2a_agents(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  protocol_binding TEXT NOT NULL,
  protocol_version TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  UNIQUE(agent_id, url, protocol_binding, protocol_version)
);

CREATE TABLE a2a_skills (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES a2a_agents(id) ON DELETE CASCADE,
  remote_skill_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]',
  examples_json TEXT NOT NULL DEFAULT '[]',
  input_modes_json TEXT NOT NULL DEFAULT '[]',
  output_modes_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL,
  UNIQUE(agent_id, remote_skill_id)
);

CREATE TABLE a2a_tasks (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES a2a_agents(id) ON DELETE CASCADE,
  remote_task_id TEXT NOT NULL,
  context_id TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL CHECK (state IN (
    'submitted','working','completed','failed','canceled',
    'input-required','auth-required','rejected'
  )),
  request_text TEXT NOT NULL,
  response_text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(agent_id, remote_task_id)
);

CREATE INDEX a2a_agents_enabled_idx ON a2a_agents(enabled);
CREATE INDEX a2a_interfaces_agent_idx ON a2a_interfaces(agent_id);
CREATE INDEX a2a_skills_agent_idx ON a2a_skills(agent_id);
CREATE INDEX a2a_tasks_agent_created_idx ON a2a_tasks(agent_id, created_at DESC);
