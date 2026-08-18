import type {
  A2aAgent,
  A2aInterface,
  A2aRepo,
  A2aSkill,
  A2aTask,
} from '../../application/ports/a2a-repo.js';
import type { Db } from './types.js';

export class SqliteA2aRepo implements A2aRepo {
  constructor(private readonly db: Db) {}

  list(): A2aAgent[] {
    return (this.db.prepare('SELECT * FROM a2a_agents ORDER BY created_at DESC, id DESC LIMIT 100').all() as A2aAgentRow[]).map(toAgent);
  }

  get(id: string): A2aAgent | undefined {
    const row = this.db.prepare('SELECT * FROM a2a_agents WHERE id = ?').get(id) as A2aAgentRow | undefined;
    return row === undefined ? undefined : toAgent(row);
  }

  create(agent: A2aAgent): A2aAgent {
    this.db.prepare(`INSERT INTO a2a_agents
      (id,name,description,base_url,auth_kind,auth_header,enabled,timeout_ms,status,last_error,last_connected_at,protocol_version,agent_version,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      agent.id,
      agent.name,
      agent.description,
      agent.baseUrl,
      agent.authKind,
      agent.authHeader,
      agent.enabled ? 1 : 0,
      agent.timeoutMs,
      agent.status,
      agent.lastError,
      agent.lastConnectedAt ?? null,
      agent.protocolVersion,
      agent.agentVersion,
      agent.createdAt,
      agent.updatedAt,
    );
    return agent;
  }

  update(
    id: string,
    patch: { [K in keyof A2aAgent]?: A2aAgent[K] | undefined },
  ): A2aAgent | undefined {
    const current = this.get(id);
    if (current === undefined) return undefined;
    const next = {
      ...current,
      ...withoutUndefined(patch),
      id,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
    } as A2aAgent;
    this.db.prepare(`UPDATE a2a_agents SET
      name=?,description=?,base_url=?,auth_kind=?,auth_header=?,enabled=?,timeout_ms=?,status=?,last_error=?,last_connected_at=?,protocol_version=?,agent_version=?,updated_at=?
      WHERE id=?`).run(
      next.name,
      next.description,
      next.baseUrl,
      next.authKind,
      next.authHeader,
      next.enabled ? 1 : 0,
      next.timeoutMs,
      next.status,
      next.lastError,
      next.lastConnectedAt ?? null,
      next.protocolVersion,
      next.agentVersion,
      next.updatedAt,
      id,
    );
    return next;
  }

  delete(id: string): boolean {
    return this.db.prepare('DELETE FROM a2a_agents WHERE id = ?').run(id).changes > 0;
  }

  interfaces(agentId: string): A2aInterface[] {
    return (this.db.prepare(
      'SELECT * FROM a2a_interfaces WHERE agent_id = ? ORDER BY protocol_binding, url, id',
    ).all(agentId) as A2aInterfaceRow[]).map(toInterface);
  }

  skills(agentId: string): A2aSkill[] {
    return (this.db.prepare(
      'SELECT * FROM a2a_skills WHERE agent_id = ? ORDER BY name, remote_skill_id, id',
    ).all(agentId) as A2aSkillRow[]).map(toSkill);
  }

  replaceDiscovery(
    agentId: string,
    interfaces: A2aInterface[],
    skills: A2aSkill[],
  ): void {
    const replace = this.db.transaction(() => {
      this.db.prepare('DELETE FROM a2a_interfaces WHERE agent_id = ?').run(agentId);
      this.db.prepare('DELETE FROM a2a_skills WHERE agent_id = ?').run(agentId);
      const insertInterface = this.db.prepare(`INSERT INTO a2a_interfaces
        (id,agent_id,url,protocol_binding,protocol_version,updated_at) VALUES (?,?,?,?,?,?)`);
      for (const item of interfaces) {
        insertInterface.run(
          item.id,
          agentId,
          item.url,
          item.protocolBinding,
          item.protocolVersion,
          item.updatedAt,
        );
      }
      const insertSkill = this.db.prepare(`INSERT INTO a2a_skills
        (id,agent_id,remote_skill_id,name,description,tags_json,examples_json,input_modes_json,output_modes_json,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`);
      for (const skill of skills) {
        insertSkill.run(
          skill.id,
          agentId,
          skill.remoteSkillId,
          skill.name,
          skill.description,
          JSON.stringify(skill.tags),
          JSON.stringify(skill.examples),
          JSON.stringify(skill.inputModes),
          JSON.stringify(skill.outputModes),
          skill.updatedAt,
        );
      }
    });
    replace();
  }

  listTasks(agentId?: string): A2aTask[] {
    const rows = agentId === undefined
      ? this.db.prepare('SELECT * FROM a2a_tasks ORDER BY created_at DESC, id DESC LIMIT 100').all()
      : this.db.prepare(
          'SELECT * FROM a2a_tasks WHERE agent_id = ? ORDER BY created_at DESC, id DESC LIMIT 100',
        ).all(agentId);
    return (rows as A2aTaskRow[]).map(toTask);
  }

  getTask(id: string): A2aTask | undefined {
    const row = this.db.prepare('SELECT * FROM a2a_tasks WHERE id = ?').get(id) as A2aTaskRow | undefined;
    return row === undefined ? undefined : toTask(row);
  }

  createTask(task: A2aTask): A2aTask {
    this.db.prepare(`INSERT INTO a2a_tasks
      (id,agent_id,remote_task_id,context_id,state,request_text,response_text,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(
      task.id,
      task.agentId,
      task.remoteTaskId,
      task.contextId,
      task.state,
      task.requestText,
      task.responseText,
      task.createdAt,
      task.updatedAt,
    );
    return task;
  }

  updateTask(
    id: string,
    patch: { [K in keyof A2aTask]?: A2aTask[K] | undefined },
  ): A2aTask | undefined {
    const current = this.getTask(id);
    if (current === undefined) return undefined;
    const next = {
      ...current,
      ...withoutUndefined(patch),
      id,
      agentId: current.agentId,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
    } as A2aTask;
    this.db.prepare(`UPDATE a2a_tasks SET
      remote_task_id=?,context_id=?,state=?,request_text=?,response_text=?,updated_at=? WHERE id=?`).run(
      next.remoteTaskId,
      next.contextId,
      next.state,
      next.requestText,
      next.responseText,
      next.updatedAt,
      id,
    );
    return next;
  }
}

interface A2aAgentRow {
  id: string;
  name: string;
  description: string;
  base_url: string;
  auth_kind: string;
  auth_header: string;
  enabled: number;
  timeout_ms: number;
  status: string;
  last_error: string;
  last_connected_at: string | null;
  protocol_version: string;
  agent_version: string;
  created_at: string;
  updated_at: string;
}

interface A2aInterfaceRow {
  id: string;
  agent_id: string;
  url: string;
  protocol_binding: string;
  protocol_version: string;
  updated_at: string;
}

interface A2aSkillRow {
  id: string;
  agent_id: string;
  remote_skill_id: string;
  name: string;
  description: string;
  tags_json: string;
  examples_json: string;
  input_modes_json: string;
  output_modes_json: string;
  updated_at: string;
}

interface A2aTaskRow {
  id: string;
  agent_id: string;
  remote_task_id: string;
  context_id: string;
  state: string;
  request_text: string;
  response_text: string;
  created_at: string;
  updated_at: string;
}

function toAgent(row: A2aAgentRow): A2aAgent {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    baseUrl: row.base_url,
    authKind: row.auth_kind as A2aAgent['authKind'],
    authHeader: row.auth_header,
    enabled: row.enabled === 1,
    timeoutMs: row.timeout_ms,
    status: row.status as A2aAgent['status'],
    lastError: row.last_error,
    ...(row.last_connected_at === null ? {} : { lastConnectedAt: row.last_connected_at }),
    protocolVersion: row.protocol_version,
    agentVersion: row.agent_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toInterface(row: A2aInterfaceRow): A2aInterface {
  return {
    id: row.id,
    agentId: row.agent_id,
    url: row.url,
    protocolBinding: row.protocol_binding,
    protocolVersion: row.protocol_version,
    updatedAt: row.updated_at,
  };
}

function toSkill(row: A2aSkillRow): A2aSkill {
  return {
    id: row.id,
    agentId: row.agent_id,
    remoteSkillId: row.remote_skill_id,
    name: row.name,
    description: row.description,
    tags: parseStringArray(row.tags_json),
    examples: parseStringArray(row.examples_json),
    inputModes: parseStringArray(row.input_modes_json),
    outputModes: parseStringArray(row.output_modes_json),
    updatedAt: row.updated_at,
  };
}

function toTask(row: A2aTaskRow): A2aTask {
  return {
    id: row.id,
    agentId: row.agent_id,
    remoteTaskId: row.remote_task_id,
    contextId: row.context_id,
    state: row.state as A2aTask['state'],
    requestText: row.request_text,
    responseText: row.response_text,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')
      ? parsed
      : [];
  } catch {
    return [];
  }
}

function withoutUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Partial<T>;
}
