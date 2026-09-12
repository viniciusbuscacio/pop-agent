import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { A2aClient, A2aClientFactory } from '../ports/a2a-client.js';
import type {
  A2aAgent,
  A2aInterface,
  A2aRepo,
  A2aSkill,
  A2aTask,
} from '../ports/a2a-repo.js';
import type { SecretsRepo } from '../ports/secrets-repo.js';
import { A2A_LIMITS, A2aService } from './a2a-service.js';

class MemoryA2aRepo implements A2aRepo {
  agents = new Map<string, A2aAgent>();
  discoveredInterfaces: A2aInterface[] = [];
  discoveredSkills: A2aSkill[] = [];
  tasks = new Map<string, A2aTask>();

  list(): A2aAgent[] { return [...this.agents.values()]; }
  get(id: string): A2aAgent | undefined { return this.agents.get(id); }
  create(agent: A2aAgent): A2aAgent { this.agents.set(agent.id, agent); return agent; }
  update(id: string, patch: Partial<A2aAgent>): A2aAgent | undefined {
    const current = this.agents.get(id);
    if (current === undefined) return undefined;
    const next = { ...current, ...patch };
    this.agents.set(id, next);
    return next;
  }
  delete(id: string): boolean { return this.agents.delete(id); }
  interfaces(agentId: string): A2aInterface[] {
    return this.discoveredInterfaces.filter((item) => item.agentId === agentId);
  }
  skills(agentId: string): A2aSkill[] {
    return this.discoveredSkills.filter((item) => item.agentId === agentId);
  }
  replaceDiscovery(agentId: string, interfaces: A2aInterface[], skills: A2aSkill[]): void {
    this.discoveredInterfaces = [
      ...this.discoveredInterfaces.filter((item) => item.agentId !== agentId),
      ...interfaces,
    ];
    this.discoveredSkills = [
      ...this.discoveredSkills.filter((item) => item.agentId !== agentId),
      ...skills,
    ];
  }
  listTasks(agentId?: string): A2aTask[] {
    return [...this.tasks.values()].filter((task) => agentId === undefined || task.agentId === agentId);
  }
  getTask(id: string): A2aTask | undefined { return this.tasks.get(id); }
  createTask(task: A2aTask): A2aTask { this.tasks.set(task.id, task); return task; }
  updateTask(id: string, patch: Partial<A2aTask>): A2aTask | undefined {
    const current = this.tasks.get(id);
    if (current === undefined) return undefined;
    const next = { ...current, ...patch };
    this.tasks.set(id, next);
    return next;
  }
}

class MemorySecrets implements SecretsRepo {
  readonly values = new Map<string, string>();
  get(key: string): string | undefined { return this.values.get(key); }
  set(key: string, value: string): void { this.values.set(key, value); }
  delete(key: string): void { this.values.delete(key); }
}

let repo: MemoryA2aRepo;
let secrets: MemorySecrets;
let client: A2aClient;
let createClient: ReturnType<typeof vi.fn<A2aClientFactory['create']>>;
let service: A2aService;

beforeEach(() => {
  repo = new MemoryA2aRepo();
  secrets = new MemorySecrets();
  client = {
    discover: vi.fn(() => Promise.resolve({
      protocolVersion: '0.3.0',
      agentVersion: '1.2.3',
      interfaces: [{
        url: 'https://agent.test/a2a',
        protocolBinding: 'JSONRPC',
        protocolVersion: '0.3.0',
      }],
      skills: [{
        id: 'weather',
        name: 'Weather',
        description: 'Forecasts',
        tags: ['weather'],
        examples: ['Weather in Rio'],
        inputModes: ['text/plain'],
        outputModes: ['text/plain'],
      }],
    })),
    sendText: vi.fn(() => Promise.resolve({
      remoteTaskId: 'remote-1', contextId: 'context-1', state: 'working' as const, responseText: '',
    })),
    getTask: vi.fn(() => Promise.resolve({
      remoteTaskId: 'remote-1', contextId: 'context-1', state: 'completed' as const, responseText: 'Sunny',
    })),
    cancelTask: vi.fn(() => Promise.resolve({
      remoteTaskId: 'remote-1', contextId: 'context-1', state: 'canceled' as const, responseText: '',
    })),
    continueTask: vi.fn(() => Promise.resolve({
      remoteTaskId: 'remote-1', contextId: 'context-1', state: 'working' as const, responseText: 'Continuing',
    })),
  };
  createClient = vi.fn(() => client);
  service = new A2aService({ repo, secrets, clients: { create: createClient } });
});

function createAgent(credential = 'top-secret') {
  return service.create({
    name: 'Weather agent',
    description: 'Remote forecasts',
    baseUrl: 'https://agent.test/a2a',
    authKind: 'bearer',
    authHeader: '',
    enabled: true,
    timeoutMs: 10_000,
    credential,
  });
}

describe('A2aService', () => {
  it('owns CRUD while keeping credentials out of returned agent data', () => {
    const created = createAgent();

    expect(created).not.toHaveProperty('credential');
    expect(secrets.get(A2aService.secretKey(created.id))).toBe('top-secret');
    expect(service.update(created.id, { name: 'Renamed', credential: 'replacement' })).toMatchObject({
      name: 'Renamed',
    });
    expect(secrets.get(A2aService.secretKey(created.id))).toBe('replacement');
    expect(service.list()).toHaveLength(1);
    expect(service.delete(created.id)).toBe(true);
    expect(secrets.get(A2aService.secretKey(created.id))).toBeUndefined();
  });

  it('validates Foundry card paths and encrypted Entra client credentials', () => {
    const created = service.create({
      name: 'Foundry agent', description: '', baseUrl: 'https://foundry.example/a2a',
      agentCardPath: 'agentCard/v1.0', authKind: 'microsoft-entra', authHeader: '',
      entraTenantId: '0269f5ec-2243-438f-90ec-7a4b9c20ca9c',
      entraClientId: '9595bd7c-fa1a-4091-85fc-09546dc1306c',
      entraScope: 'https://ai.azure.com/.default',
      enabled: true, timeoutMs: 120_000, credential: 'client-secret',
    });

    expect(created).toMatchObject({
      agentCardPath: 'agentCard/v1.0', authKind: 'microsoft-entra',
      entraScope: 'https://ai.azure.com/.default', hasCredential: true,
    });
    expect(created).not.toHaveProperty('credential');
    expect(secrets.get(A2aService.secretKey(created.id))).toBe('client-secret');

    for (const agentCardPath of [
      'https://evil.example/card', '/absolute/card', '../card', 'agentCard/v1.0?x=1',
    ]) {
      expect(() => service.create({
        name: 'Bad', description: '', baseUrl: 'https://foundry.example/a2a',
        agentCardPath, authKind: 'none', authHeader: '', enabled: true, timeoutMs: 10_000,
      })).toThrow();
    }
  });

  it('discovers and persists interfaces, skills, and negotiated versions using the secret', async () => {
    const agent = createAgent();

    const discovered = await service.test(agent.id);

    expect(createClient).toHaveBeenCalledWith(expect.objectContaining({ id: agent.id }), 'top-secret');
    expect(discovered).toMatchObject({
      status: 'connected',
      protocolVersion: '0.3.0',
      agentVersion: '1.2.3',
      interfaces: [{ protocolBinding: 'JSONRPC' }],
      skills: [{ remoteSkillId: 'weather', name: 'Weather' }],
    });
  });

  it('redacts a credential from discovery failures before persisting or throwing it', async () => {
    const agent = createAgent();
    vi.mocked(client.discover).mockRejectedValueOnce(new Error('Authorization top-secret denied'));

    await expect(service.discover(agent.id)).rejects.toThrow('could not be reached');
    expect(repo.get(agent.id)).toMatchObject({
      status: 'error',
      lastError: 'The remote A2A agent could not be reached.',
    });

    vi.mocked(client.sendText).mockRejectedValueOnce(new Error('Bearer top-secret rejected'));
    await expect(service.sendText(agent.id, 'hello')).rejects.toThrow(
      'could not be reached',
    );
    expect(service.listTasks(agent.id)).toEqual([
      expect.objectContaining({
        state: 'failed',
        requestText: 'hello',
        responseText: 'The remote A2A agent could not be reached.',
      }),
    ]);
  });

  it('persists foreground send, get, cancel, and continue results already mapped by the client', async () => {
    const agent = createAgent();
    const task = await service.sendText(agent.id, 'Forecast Rio');
    expect(task).toMatchObject({
      agentId: agent.id,
      remoteTaskId: 'remote-1',
      state: 'working',
      requestText: 'Forecast Rio',
    });

    expect(await service.getTask(task.id)).toMatchObject({ state: 'completed', responseText: 'Sunny' });
    await expect(service.cancelTask(task.id)).rejects.toMatchObject({ code: 'invalid_state' });
    repo.updateTask(task.id, { state: 'working' });
    expect(await service.cancelTask(task.id)).toMatchObject({ state: 'canceled' });
    repo.updateTask(task.id, { state: 'input-required' });
    expect(await service.continueTask(task.id, 'Add tomorrow')).toMatchObject({
      state: 'working', responseText: 'Continuing', requestText: 'Forecast Rio',
    });
    expect(client.continueTask).toHaveBeenCalledWith(
      'remote-1', 'context-1', 'Add tomorrow', undefined, 'unknown',
    );
    expect(service.listTasks(agent.id)).toHaveLength(1);
  });

  it('rejects unbounded configuration and foreground text', async () => {
    expect(() => service.create({
      name: 'x'.repeat(A2A_LIMITS.name + 1),
      description: '',
      baseUrl: 'https://agent.test',
      authKind: 'none',
      authHeader: '',
      enabled: true,
      timeoutMs: 10_000,
    })).toThrow('name is too long');

    const agent = createAgent();
    await expect(service.sendText(agent.id, 'x'.repeat(A2A_LIMITS.text + 1))).rejects.toThrow(
      'requestText is too long',
    );
  });
});
