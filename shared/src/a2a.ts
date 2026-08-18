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

export interface A2aInterfaceDTO {
  id: string;
  url: string;
  protocolBinding: string;
  protocolVersion: string;
}

export interface A2aSkillDTO {
  id: string;
  remoteSkillId: string;
  name: string;
  description: string;
  tags: string[];
  examples: string[];
  inputModes: string[];
  outputModes: string[];
}

/** A configured outbound agent. Credentials never cross the HTTP boundary. */
export interface A2aAgentDTO {
  id: string;
  name: string;
  description: string;
  baseUrl: string;
  authKind: A2aAuthKind;
  authHeader: string;
  hasCredential: boolean;
  enabled: boolean;
  timeoutMs: number;
  status: A2aAgentStatus;
  lastError: string;
  lastConnectedAt?: string;
  protocolVersion: string;
  agentVersion: string;
  interfaces: A2aInterfaceDTO[];
  skills: A2aSkillDTO[];
  createdAt: string;
  updatedAt: string;
}

export interface A2aTaskDTO {
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

export interface A2aAgentsResponse { agents: A2aAgentDTO[]; }
export interface A2aAgentResponse { agent: A2aAgentDTO; }
export type A2aTestResponse = A2aAgentResponse;
export interface A2aTasksResponse { tasks: A2aTaskDTO[]; }
export interface A2aTaskResponse { task: A2aTaskDTO; }
