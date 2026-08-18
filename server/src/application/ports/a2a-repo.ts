export type A2aAuthKind = 'none' | 'bearer' | 'api-key' | 'custom-header';
export type A2aAgentStatus = 'unknown' | 'connected' | 'error';
export type A2aTaskState =
  | 'submitted'
  | 'working'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'input-required'
  | 'auth-required'
  | 'rejected';

export interface A2aAgent {
  id: string;
  name: string;
  description: string;
  baseUrl: string;
  authKind: A2aAuthKind;
  authHeader: string;
  enabled: boolean;
  timeoutMs: number;
  status: A2aAgentStatus;
  lastError: string;
  lastConnectedAt?: string;
  protocolVersion: string;
  agentVersion: string;
  createdAt: string;
  updatedAt: string;
}

export interface A2aInterface {
  id: string;
  agentId: string;
  url: string;
  protocolBinding: string;
  protocolVersion: string;
  updatedAt: string;
}

export interface A2aSkill {
  id: string;
  agentId: string;
  remoteSkillId: string;
  name: string;
  description: string;
  tags: string[];
  examples: string[];
  inputModes: string[];
  outputModes: string[];
  updatedAt: string;
}

export interface A2aTask {
  id: string;
  agentId: string;
  remoteTaskId: string;
  contextId: string;
  state: A2aTaskState;
  requestText: string;
  responseText: string;
  createdAt: string;
  updatedAt: string;
}

/** Durable configuration, discovery cache, and remote task journal for outbound A2A. */
export interface A2aRepo {
  list(): A2aAgent[];
  get(id: string): A2aAgent | undefined;
  create(agent: A2aAgent): A2aAgent;
  update(
    id: string,
    patch: { [K in keyof A2aAgent]?: A2aAgent[K] | undefined },
  ): A2aAgent | undefined;
  delete(id: string): boolean;

  interfaces(agentId: string): A2aInterface[];
  skills(agentId: string): A2aSkill[];
  replaceDiscovery(
    agentId: string,
    interfaces: A2aInterface[],
    skills: A2aSkill[],
  ): void;

  listTasks(agentId?: string): A2aTask[];
  getTask(id: string): A2aTask | undefined;
  createTask(task: A2aTask): A2aTask;
  updateTask(
    id: string,
    patch: { [K in keyof A2aTask]?: A2aTask[K] | undefined },
  ): A2aTask | undefined;
}
