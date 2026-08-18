import { entityId } from '../../domain/ids.js';
import type {
  A2aClient,
  A2aClientFactory,
  A2aTaskResult,
  DiscoveredA2aAgent,
} from '../ports/a2a-client.js';
import type {
  A2aAgent,
  A2aAuthKind,
  A2aInterface,
  A2aRepo,
  A2aSkill,
  A2aTask,
} from '../ports/a2a-repo.js';
import type { SecretsRepo } from '../ports/secrets-repo.js';

export const A2A_LIMITS = {
  name: 120,
  description: 500,
  baseUrl: 2_000,
  authHeader: 200,
  credential: 4_000,
  text: 32_000,
  responseText: 64_000,
  remoteId: 1_000,
  protocolField: 200,
  interfaces: 20,
  skills: 100,
  listItems: 100,
  listItem: 1_000,
  timeoutMinMs: 1_000,
  timeoutMaxMs: 300_000,
} as const;

export type A2aAgentWithDiscovery = A2aAgent & {
  interfaces: A2aInterface[];
  skills: A2aSkill[];
  hasCredential: boolean;
};

export interface CreateA2aAgentInput {
  name: string;
  description: string;
  baseUrl: string;
  authKind: A2aAuthKind;
  authHeader: string;
  enabled: boolean;
  timeoutMs: number;
  credential?: string;
}

export type UpdateA2aAgentInput = Partial<
  Pick<
    CreateA2aAgentInput,
    'name' | 'description' | 'baseUrl' | 'authKind' | 'authHeader' | 'enabled' | 'timeoutMs'
  >
> & { credential?: string | null };

/** Outbound A2A configuration, discovery, and foreground task use cases. */
export class A2aService {
  constructor(
    private readonly deps: {
      repo: A2aRepo;
      secrets: SecretsRepo;
      clients: A2aClientFactory;
    },
  ) {}

  list(): A2aAgentWithDiscovery[] {
    return this.deps.repo.list().map((agent) => this.withDiscovery(agent));
  }

  get(id: string): A2aAgentWithDiscovery | undefined {
    const agent = this.deps.repo.get(id);
    return agent === undefined ? undefined : this.withDiscovery(agent);
  }

  create(input: CreateA2aAgentInput): A2aAgentWithDiscovery {
    const fields = validateConfig(input);
    const credential = input.authKind === 'none' ? undefined : validateCredential(input.credential);
    const now = new Date().toISOString();
    const agent: A2aAgent = {
      id: entityId('a2a-agent'),
      ...fields,
      status: 'unknown',
      lastError: '',
      protocolVersion: '',
      agentVersion: '',
      createdAt: now,
      updatedAt: now,
    };
    this.deps.repo.create(agent);
    if (credential !== undefined) this.deps.secrets.set(secretKey(agent.id), credential);
    return { ...agent, interfaces: [], skills: [], hasCredential: credential !== undefined };
  }

  update(id: string, input: UpdateA2aAgentInput): A2aAgentWithDiscovery | undefined {
    const current = this.deps.repo.get(id);
    if (current === undefined) return undefined;
    const patch = validatePatch(input, current);
    const connectionChanged = input.baseUrl !== undefined
      || input.authKind !== undefined
      || input.authHeader !== undefined
      || input.credential !== undefined;
    if (connectionChanged) {
      Object.assign(patch, {
        status: 'unknown' as const,
        lastError: '',
        protocolVersion: '',
        agentVersion: '',
      });
    }
    const credential = input.credential === undefined || input.credential === null
      ? input.credential
      : validateCredential(input.credential);
    const updated = this.deps.repo.update(id, patch);
    if (updated === undefined) return undefined;
    if (credential === null || input.authKind === 'none') {
      this.deps.secrets.delete(secretKey(id));
    } else if (credential !== undefined) {
      this.deps.secrets.set(secretKey(id), credential);
    }
    if (connectionChanged) this.deps.repo.replaceDiscovery(id, [], []);
    return this.withDiscovery(updated);
  }

  delete(id: string): boolean {
    const deleted = this.deps.repo.delete(id);
    if (deleted) this.deps.secrets.delete(secretKey(id));
    return deleted;
  }

  /** Tests the configured endpoint and atomically replaces its discovered card data. */
  async discover(id: string, signal?: AbortSignal): Promise<A2aAgentWithDiscovery> {
    const agent = this.requireAgent(id);
    const credential = this.deps.secrets.get(secretKey(id));
    try {
      const discovered = normalizeDiscovery(
        await this.deps.clients.create(agent, credential).discover(signal),
      );
      const now = new Date().toISOString();
      const interfaces = discovered.interfaces.map((value) => ({
        ...value,
        id: entityId('a2a-interface'),
        agentId: id,
        updatedAt: now,
      }));
      const skills = discovered.skills.map((value) => ({
        id: entityId('a2a-skill'),
        agentId: id,
        remoteSkillId: value.id,
        name: value.name,
        description: value.description,
        tags: value.tags,
        examples: value.examples,
        inputModes: value.inputModes,
        outputModes: value.outputModes,
        updatedAt: now,
      }));
      this.deps.repo.replaceDiscovery(id, interfaces, skills);
      const updated = this.deps.repo.update(id, {
        status: 'connected',
        lastError: '',
        lastConnectedAt: now,
        protocolVersion: discovered.protocolVersion,
        agentVersion: discovered.agentVersion ?? '',
      });
      if (updated === undefined) throw new Error('A2A agent disappeared during discovery.');
      return {
        ...updated,
        interfaces,
        skills,
        hasCredential: this.deps.secrets.get(secretKey(id)) !== undefined,
      };
    } catch (error) {
      const failure = operationError(error, credential);
      this.deps.repo.update(id, { status: 'error', lastError: failure.message });
      throw failure;
    }
  }

  test(id: string, signal?: AbortSignal): Promise<A2aAgentWithDiscovery> {
    return this.discover(id, signal);
  }

  listTasks(agentId?: string): A2aTask[] {
    return this.deps.repo.listTasks(agentId);
  }

  task(id: string): A2aTask | undefined {
    return this.deps.repo.getTask(id);
  }

  async sendText(agentId: string, text: string, signal?: AbortSignal): Promise<A2aTask> {
    const requestText = requiredText('requestText', text, A2A_LIMITS.text);
    const { agent, client, credential } = this.clientFor(agentId);
    const now = new Date().toISOString();
    const localId = entityId('a2a-task');
    const accepted = this.deps.repo.createTask({
      id: localId,
      agentId: agent.id,
      // The local id is a unique placeholder until the remote acknowledges a task.
      remoteTaskId: localId,
      contextId: '',
      state: 'submitted',
      requestText,
      responseText: '',
      createdAt: now,
      updatedAt: now,
    });
    try {
      const result = normalizeTaskResult(await client.sendText(requestText, signal));
      return this.deps.repo.updateTask(localId, {
        remoteTaskId: result.remoteTaskId,
        contextId: result.contextId,
        state: result.state,
        responseText: result.responseText,
      }) ?? accepted;
    } catch (error) {
      const failure = operationError(error, credential);
      this.deps.repo.updateTask(localId, { state: 'failed', responseText: failure.message });
      throw failure;
    }
  }

  async getTask(id: string, signal?: AbortSignal): Promise<A2aTask> {
    const task = this.requireTask(id);
    if (isTerminal(task.state)) return task;
    return this.refreshTask(id, (client, current) => client.getTask(current.remoteTaskId, signal));
  }

  async cancelTask(id: string, signal?: AbortSignal): Promise<A2aTask> {
    const task = this.requireTask(id);
    if (isTerminal(task.state)) throw Object.assign(new Error('The A2A task is already terminal.'), { code: 'invalid_state' });
    return this.refreshTask(id, (client, current) => client.cancelTask(current.remoteTaskId, signal));
  }

  async continueTask(id: string, text: string, signal?: AbortSignal): Promise<A2aTask> {
    const task = this.requireTask(id);
    if (task.state !== 'input-required') {
      throw Object.assign(new Error('The A2A task is not waiting for input.'), { code: 'invalid_state' });
    }
    const continuation = requiredText('requestText', text, A2A_LIMITS.text);
    return this.refreshTask(id, (client, current) =>
      client.continueTask(current.remoteTaskId, current.contextId, continuation, signal),
    );
  }

  static secretKey(id: string): string {
    return secretKey(id);
  }

  private withDiscovery(agent: A2aAgent): A2aAgentWithDiscovery {
    return {
      ...agent,
      interfaces: this.deps.repo.interfaces(agent.id),
      skills: this.deps.repo.skills(agent.id),
      hasCredential: this.deps.secrets.get(secretKey(agent.id)) !== undefined,
    };
  }

  private requireTask(id: string): A2aTask {
    const task = this.deps.repo.getTask(id);
    if (task === undefined) {
      throw Object.assign(new Error('No such A2A task.'), { code: 'task_not_found' });
    }
    return task;
  }

  private requireAgent(id: string): A2aAgent {
    const agent = this.deps.repo.get(id);
    if (agent === undefined) {
      throw Object.assign(new Error('No such A2A agent.'), { code: 'agent_not_found' });
    }
    return agent;
  }

  private clientFor(agentId: string): {
    agent: A2aAgent;
    client: A2aClient;
    credential: string | undefined;
  } {
    const agent = this.requireAgent(agentId);
    if (!agent.enabled) {
      throw Object.assign(new Error('A2A agent is disabled.'), { code: 'agent_disabled' });
    }
    const credential = this.deps.secrets.get(secretKey(agent.id));
    try {
      return {
        agent,
        client: this.deps.clients.create(agent, credential),
        credential,
      };
    } catch (error) {
      throw operationError(error, credential);
    }
  }

  private async refreshTask(
    id: string,
    operation: (client: A2aClient, task: A2aTask) => Promise<A2aTaskResult>,
  ): Promise<A2aTask> {
    const task = this.requireTask(id);
    const { client, credential } = this.clientFor(task.agentId);
    let result: A2aTaskResult;
    try {
      result = normalizeTaskResult(await operation(client, task));
    } catch (error) {
      throw operationError(error, credential);
    }
    if (!canTransition(task.state, result.state)) {
      throw Object.assign(new Error('The remote A2A task returned an invalid state transition.'), {
        code: 'protocol_error',
      });
    }
    const updated = this.deps.repo.updateTask(id, {
      remoteTaskId: result.remoteTaskId,
      contextId: result.contextId,
      state: result.state,
      responseText: result.responseText,
    });
    if (updated === undefined) throw new Error('A2A task disappeared during update.');
    return updated;
  }
}

function secretKey(id: string): string {
  return `a2a:${id}:credential`;
}

function validateConfig(input: CreateA2aAgentInput): Omit<
  A2aAgent,
  | 'id'
  | 'status'
  | 'lastError'
  | 'lastConnectedAt'
  | 'protocolVersion'
  | 'agentVersion'
  | 'createdAt'
  | 'updatedAt'
> {
  const baseUrl = requiredText('baseUrl', input.baseUrl, A2A_LIMITS.baseUrl);
  const parsed = new URL(baseUrl);
  if (parsed.protocol !== 'https:') {
    throw new Error('baseUrl must use https.');
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw new Error('baseUrl must not contain credentials.');
  }
  if (!['none', 'bearer', 'api-key', 'custom-header'].includes(input.authKind)) {
    throw new Error('Invalid A2A auth kind.');
  }
  if (input.authHeader !== '' && (
    !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(input.authHeader)
    || FORBIDDEN_AUTH_HEADERS.has(input.authHeader.toLowerCase())
  )) {
    throw new Error('Invalid A2A authentication header.');
  }
  if (input.authKind === 'custom-header' && input.authHeader === '') {
    throw new Error('Custom-header authentication requires a header name.');
  }
  if (!Number.isInteger(input.timeoutMs) || input.timeoutMs < A2A_LIMITS.timeoutMinMs || input.timeoutMs > A2A_LIMITS.timeoutMaxMs) {
    throw new Error('timeoutMs is outside the allowed range.');
  }
  return {
    name: requiredText('name', input.name, A2A_LIMITS.name),
    description: boundedText('description', input.description, A2A_LIMITS.description),
    baseUrl,
    authKind: input.authKind,
    authHeader: boundedText('authHeader', input.authHeader, A2A_LIMITS.authHeader),
    enabled: input.enabled,
    timeoutMs: input.timeoutMs,
  };
}

function validatePatch(input: UpdateA2aAgentInput, current: A2aAgent): Partial<A2aAgent> {
  const allowed = {
    name: input.name,
    description: input.description,
    baseUrl: input.baseUrl,
    authKind: input.authKind,
    authHeader: input.authHeader,
    enabled: input.enabled,
    timeoutMs: input.timeoutMs,
  };
  const merged = Object.fromEntries(
    Object.entries(allowed).filter(([, value]) => value !== undefined),
  ) as Partial<CreateA2aAgentInput>;
  if (Object.keys(merged).length === 0) return {};
  const defaults: CreateA2aAgentInput = {
    name: input.name ?? current.name,
    description: input.description ?? current.description,
    baseUrl: input.baseUrl ?? current.baseUrl,
    authKind: input.authKind ?? current.authKind,
    authHeader: input.authHeader ?? current.authHeader,
    enabled: input.enabled ?? current.enabled,
    timeoutMs: input.timeoutMs ?? current.timeoutMs,
  };
  const validated = validateConfig(defaults);
  const patch = Object.fromEntries(
    Object.keys(merged).map((key) => [key, validated[key as keyof typeof validated]]),
  ) as Partial<A2aAgent>;
  if (input.authKind === 'none') patch.authHeader = '';
  return patch;
}

const FORBIDDEN_AUTH_HEADERS = new Set([
  'host', 'content-length', 'connection', 'transfer-encoding', 'cookie', 'set-cookie',
  'proxy-authorization', 'proxy-authenticate',
]);

function validateCredential(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return requiredText('credential', value, A2A_LIMITS.credential);
}

function boundedText(name: string, value: string, max: number): string {
  if (typeof value !== 'string' || value.length > max) throw new Error(`${name} is too long.`);
  return value;
}

function requiredText(name: string, value: string, max: number): string {
  const checked = boundedText(name, value, max);
  if (checked.trim() === '') throw new Error(`${name} is required.`);
  return checked;
}

function truncate(value: string, max: number): string {
  return value.slice(0, max);
}

function boundedList(values: string[]): string[] {
  return values.slice(0, A2A_LIMITS.listItems).map((value) => truncate(value, A2A_LIMITS.listItem));
}

function normalizeDiscovery(value: DiscoveredA2aAgent): DiscoveredA2aAgent {
  return {
    protocolVersion: truncate(value.protocolVersion, A2A_LIMITS.protocolField),
    ...(value.agentVersion === undefined
      ? {}
      : { agentVersion: truncate(value.agentVersion, A2A_LIMITS.protocolField) }),
    interfaces: value.interfaces.slice(0, A2A_LIMITS.interfaces).map((item) => ({
      url: truncate(item.url, A2A_LIMITS.baseUrl),
      protocolBinding: truncate(item.protocolBinding, A2A_LIMITS.protocolField),
      protocolVersion: truncate(item.protocolVersion, A2A_LIMITS.protocolField),
    })),
    skills: value.skills.slice(0, A2A_LIMITS.skills).map((skill) => ({
      id: truncate(skill.id, A2A_LIMITS.remoteId),
      name: truncate(skill.name, A2A_LIMITS.name),
      description: truncate(skill.description, A2A_LIMITS.description),
      tags: boundedList(skill.tags),
      examples: boundedList(skill.examples),
      inputModes: boundedList(skill.inputModes),
      outputModes: boundedList(skill.outputModes),
    })),
  };
}

function normalizeTaskResult(result: A2aTaskResult): A2aTaskResult {
  const states = [
    'submitted',
    'working',
    'completed',
    'failed',
    'canceled',
    'input-required',
    'auth-required',
    'rejected',
  ];
  if (!states.includes(result.state)) {
    throw Object.assign(new Error('Invalid mapped A2A task state.'), { code: 'protocol_error' });
  }
  return {
    remoteTaskId: requiredText('remoteTaskId', result.remoteTaskId, A2A_LIMITS.remoteId),
    contextId: boundedText('contextId', result.contextId, A2A_LIMITS.remoteId),
    state: result.state,
    responseText: boundedText('responseText', result.responseText, A2A_LIMITS.responseText),
  };
}

function isTerminal(state: A2aTask['state']): boolean {
  return ['completed', 'failed', 'canceled', 'rejected'].includes(state);
}

function canTransition(from: A2aTask['state'], to: A2aTask['state']): boolean {
  if (isTerminal(from)) return to === from;
  return true;
}

function operationError(error: unknown, _credential: string | undefined): Error & { code: string } {
  const remoteCode = typeof error === 'object' && error !== null
    ? (error as Record<string, unknown>)['code']
    : undefined;
  const messages: Record<string, string> = {
    timeout: 'The A2A operation timed out.',
    canceled: 'The A2A operation was canceled.',
    authentication: 'The remote A2A agent rejected its configured credential.',
    response_too_large: 'The remote A2A response exceeded Pop Agent limits.',
    protocol_error: 'The remote A2A agent returned an invalid protocol response.',
    transport_error: 'The remote A2A agent could not be reached.',
  };
  const code = typeof remoteCode === 'string' && Object.hasOwn(messages, remoteCode)
    ? remoteCode
    : 'transport_error';
  return Object.assign(new Error(messages[code]), { code });
}
