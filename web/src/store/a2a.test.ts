import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { A2aAgentDTO, A2aTaskDTO } from '@pop-agent/shared';
import { useA2aStore } from './a2a';

const list = vi.fn();
const toggle = vi.fn();
const remove = vi.fn();
const tasks = vi.fn();

vi.mock('../services/a2a', () => ({
  a2aService: {
    list: () => list() as Promise<unknown>,
    toggle: (id: string) => toggle(id) as Promise<unknown>,
    remove: (id: string) => remove(id) as Promise<unknown>,
    tasks: (id: string) => tasks(id) as Promise<unknown>,
  },
}));

function agent(overrides: Partial<A2aAgentDTO> = {}): A2aAgentDTO {
  return {
    id: 'agent-1',
    name: 'Remote agent',
    description: 'A remote agent',
    baseUrl: 'https://agent.example',
    agentCardPath: '.well-known/agent-card.json',
    authKind: 'none',
    authHeader: '',
    entraTenantId: '',
    entraClientId: '',
    entraScope: '',
    hasCredential: false,
    enabled: true,
    timeoutMs: 60000,
    status: 'connected',
    lastError: '',
    protocolVersion: '0.3.0',
    agentVersion: '1.2.0',
    interfaces: [],
    skills: [],
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function remoteTask(): A2aTaskDTO {
  return {
    id: 'task-1',
    agentId: 'agent-1',
    remoteTaskId: 'remote-1',
    contextId: 'context-1',
    state: 'completed',
    requestText: 'Summarize this',
    responseText: 'Summary',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:01:00.000Z',
  };
}

beforeEach(() => {
  list.mockReset();
  toggle.mockReset();
  remove.mockReset();
  tasks.mockReset();
  useA2aStore.setState({ agents: undefined, tasksByAgent: {} });
});

describe('A2A store', () => {
  it('loads the independent agent projection', async () => {
    list.mockResolvedValue({ agents: [agent()] });

    await useA2aStore.getState().reload();

    expect(useA2aStore.getState().agents?.map((item) => item.id)).toEqual(['agent-1']);
  });

  it('reconciles toggle and delete responses', async () => {
    useA2aStore.setState({ agents: [agent()] });
    toggle.mockResolvedValue({ agent: agent({ enabled: false }) });
    remove.mockResolvedValue(undefined);

    await useA2aStore.getState().toggle('agent-1');
    expect(useA2aStore.getState().agents?.[0]?.enabled).toBe(false);

    await useA2aStore.getState().remove('agent-1');
    expect(useA2aStore.getState().agents).toEqual([]);
  });

  it('keeps recent remote tasks scoped by agent', async () => {
    tasks.mockResolvedValue({ tasks: [remoteTask()] });

    await useA2aStore.getState().loadTasks('agent-1');

    expect(useA2aStore.getState().tasksByAgent['agent-1']?.[0]?.remoteTaskId).toBe('remote-1');
  });
});
