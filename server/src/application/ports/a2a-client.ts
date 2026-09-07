import type { A2aAgent, A2aTaskState } from './a2a-repo.js';

export interface DiscoveredA2aInterface {
  url: string;
  protocolBinding: string;
  protocolVersion: string;
}

export interface DiscoveredA2aSkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
  examples: string[];
  inputModes: string[];
  outputModes: string[];
}

export interface DiscoveredA2aAgent {
  protocolVersion: string;
  agentVersion?: string;
  interfaces: DiscoveredA2aInterface[];
  skills: DiscoveredA2aSkill[];
}

/** Protocol task data after infrastructure maps the remote status to Pop's finite state. */
export interface A2aTaskResult {
  remoteTaskId: string;
  contextId: string;
  state: A2aTaskState;
  responseText: string;
}

export interface A2aClient {
  discover(signal?: AbortSignal): Promise<DiscoveredA2aAgent>;
  sendText(text: string, signal?: AbortSignal, author?: 'owner' | 'agent' | 'unknown'): Promise<A2aTaskResult>;
  getTask(remoteTaskId: string, signal?: AbortSignal): Promise<A2aTaskResult>;
  cancelTask(remoteTaskId: string, signal?: AbortSignal): Promise<A2aTaskResult>;
  continueTask(
    remoteTaskId: string,
    contextId: string,
    text: string,
    signal?: AbortSignal,
    author?: 'owner' | 'agent' | 'unknown',
  ): Promise<A2aTaskResult>;
}

/** Infrastructure boundary around A2A transport, authentication, and status mapping. */
export interface A2aClientFactory {
  create(agent: A2aAgent, credential: string | undefined): A2aClient;
}
