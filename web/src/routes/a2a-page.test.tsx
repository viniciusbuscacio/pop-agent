// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { A2aAgentDTO, A2aTaskDTO } from '@pop-agent/shared';
import { useA2aStore } from '../store/a2a';
import { A2aPage } from './a2a-page';

const list = vi.fn();
const create = vi.fn();
const update = vi.fn();
const testConnection = vi.fn();
const tasks = vi.fn();
const toggle = vi.fn();
const remove = vi.fn();

vi.mock('../services/a2a', () => ({
  a2aService: {
    list: () => list() as Promise<unknown>,
    create: (body: unknown) => create(body) as Promise<unknown>,
    update: (id: string, body: unknown) => update(id, body) as Promise<unknown>,
    test: (id: string) => testConnection(id) as Promise<unknown>,
    tasks: (id: string) => tasks(id) as Promise<unknown>,
    toggle: (id: string) => toggle(id) as Promise<unknown>,
    remove: (id: string) => remove(id) as Promise<unknown>,
  },
}));

type A2aAgentWithEntraFields = A2aAgentDTO & {
  agentCardPath: string;
  entraTenantId: string;
  entraClientId: string;
  entraScope: string;
};

function agent(overrides: Partial<A2aAgentWithEntraFields> = {}): A2aAgentDTO {
  return {
    id: 'agent-1',
    name: 'Research agent',
    description: 'Researches sources',
    baseUrl: 'https://research.example/a2a',
    agentCardPath: '.well-known/agent-card.json',
    authKind: 'bearer',
    authHeader: 'Authorization',
    entraTenantId: '',
    entraClientId: '',
    entraScope: 'https://ai.azure.com/.default',
    hasCredential: true,
    enabled: true,
    timeoutMs: 45000,
    status: 'connected',
    lastError: '',
    protocolVersion: '0.3.0',
    agentVersion: '2.0.0',
    interfaces: [{ id: 'interface-1', url: 'https://research.example/a2a', protocolBinding: 'JSONRPC', protocolVersion: '0.3.0' }],
    skills: [{
      id: 'skill-1', remoteSkillId: 'plan', name: 'Planning', description: 'Builds plans',
      tags: ['planning'], examples: [], inputModes: ['text/plain'], outputModes: ['text/plain'],
    }],
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  } as A2aAgentWithEntraFields;
}

const task: A2aTaskDTO = {
  id: 'task-1',
  agentId: 'agent-1',
  remoteTaskId: 'remote-task-1',
  contextId: 'context-1',
  state: 'completed',
  requestText: 'Find the source',
  responseText: 'Source found',
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:01:00.000Z',
};

function renderPage(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/a2a" element={<A2aPage />} />
        <Route path="/a2a/new" element={<A2aPage />} />
        <Route path="/a2a/:id" element={<A2aPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  for (const mock of [list, create, update, testConnection, tasks, toggle, remove]) mock.mockReset();
  useA2aStore.setState({ agents: undefined, tasksByAgent: {} });
  list.mockResolvedValue({ agents: [agent()] });
  tasks.mockResolvedValue({ tasks: [task] });
  update.mockResolvedValue({ agent: agent() });
  toggle.mockResolvedValue({ agent: agent({ enabled: false }) });
  remove.mockResolvedValue(undefined);
});

afterEach(cleanup);

describe('A2A detail presentation', () => {
  it('shows editable connection fields, discovered Agent Card data and remote tasks', async () => {
    renderPage('/a2a/agent-1');

    expect(await screen.findByDisplayValue('Research agent')).toBeTruthy();
    expect(screen.getByDisplayValue('https://research.example/a2a')).toBeTruthy();
    expect((screen.getByLabelText('Agent Card path') as HTMLInputElement).value)
      .toBe('.well-known/agent-card.json');
    expect(screen.getByText('JSONRPC · 0.3.0 · https://research.example/a2a')).toBeTruthy();
    expect(screen.getByText('Planning')).toBeTruthy();
    expect(await screen.findByText('Find the source')).toBeTruthy();
    expect(screen.getByText('Source found')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
  });

  it('tests the connection and refreshes discovered skills', async () => {
    testConnection.mockResolvedValue({
      agent: agent({
        skills: [{
          id: 'skill-2', remoteSkillId: 'search', name: 'Source search',
          description: 'Finds sources', tags: ['web'], examples: [],
          inputModes: ['text/plain'], outputModes: ['text/plain'],
        }],
      }),
    });
    renderPage('/a2a/agent-1');
    await screen.findByDisplayValue('Research agent');

    await userEvent.click(screen.getByRole('button', { name: 'Test connection' }));

    await waitFor(() => expect(testConnection).toHaveBeenCalledWith('agent-1'));
    expect(screen.getByText('Source search')).toBeTruthy();
    expect(screen.getByText('Connected and refreshed the Agent Card.')).toBeTruthy();
  });

  it('sends the selected auth kind, optional header and password credential when creating', async () => {
    create.mockResolvedValue({ agent: agent() });
    list.mockResolvedValue({ agents: [] });
    renderPage('/a2a/new');

    await userEvent.type(screen.getByLabelText('Name'), 'New remote');
    await userEvent.type(screen.getByLabelText('Base URL'), 'https://new.example');
    await userEvent.selectOptions(screen.getByLabelText('Authentication'), 'custom-header');
    await userEvent.type(screen.getByLabelText('Header name (optional)'), 'X-Agent-Key');
    await userEvent.type(screen.getByLabelText('Credential'), 'secret-value');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      name: 'New remote',
      baseUrl: 'https://new.example',
      agentCardPath: '.well-known/agent-card.json',
      authKind: 'custom-header',
      authHeader: 'X-Agent-Key',
      credential: 'secret-value',
      enabled: true,
      timeoutMs: 60000,
    });
  });

  it('applies the Microsoft Foundry preset without replacing identity fields', async () => {
    list.mockResolvedValue({ agents: [] });
    renderPage('/a2a/new');

    await userEvent.type(screen.getByLabelText('Name'), 'Foundry agent');
    await userEvent.type(screen.getByLabelText('Base URL'), 'https://foundry.example');
    await userEvent.click(screen.getByRole('button', { name: 'Use Microsoft Foundry preset' }));

    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Foundry agent');
    expect((screen.getByLabelText('Base URL') as HTMLInputElement).value)
      .toBe('https://foundry.example');
    expect((screen.getByLabelText('Agent Card path') as HTMLInputElement).value)
      .toBe('agentCard/v1.0');
    expect((screen.getByLabelText('Authentication') as HTMLSelectElement).value)
      .toBe('microsoft-entra');
    expect((screen.getByLabelText('Scope') as HTMLInputElement).value)
      .toBe('https://ai.azure.com/.default');
    expect(screen.queryByLabelText('Header name (optional)')).toBeNull();
  });

  it('requires Microsoft Entra fields and sends the client secret as the credential', async () => {
    create.mockResolvedValue({ agent: agent() });
    list.mockResolvedValue({ agents: [] });
    renderPage('/a2a/new');

    await userEvent.type(screen.getByLabelText('Name'), 'Foundry agent');
    await userEvent.type(screen.getByLabelText('Base URL'), 'https://foundry.example');
    await userEvent.selectOptions(screen.getByLabelText('Authentication'), 'microsoft-entra');

    const save = screen.getByRole('button', { name: 'Save' });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Scope') as HTMLInputElement).value)
      .toBe('https://ai.azure.com/.default');
    expect(screen.getByText('Stored encrypted on your server and never shown again.')).toBeTruthy();

    await userEvent.type(screen.getByLabelText('Tenant ID'), 'tenant-id');
    await userEvent.type(screen.getByLabelText('Client ID'), 'client-id');
    await userEvent.type(screen.getByLabelText('Client secret'), 'client-secret');
    expect((save as HTMLButtonElement).disabled).toBe(false);

    const agentCardPath = screen.getByLabelText('Agent Card path');
    await userEvent.clear(agentCardPath);
    expect((save as HTMLButtonElement).disabled).toBe(true);
    await userEvent.type(agentCardPath, '.well-known/agent-card.json');
    expect((save as HTMLButtonElement).disabled).toBe(false);
    await userEvent.click(save);

    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      agentCardPath: '.well-known/agent-card.json',
      authKind: 'microsoft-entra',
      authHeader: '',
      entraTenantId: 'tenant-id',
      entraClientId: 'client-id',
      entraScope: 'https://ai.azure.com/.default',
      credential: 'client-secret',
    });
  });

  it('shows server validation errors returned while saving', async () => {
    create.mockRejectedValue(new Error('The tenant ID is not valid.'));
    list.mockResolvedValue({ agents: [] });
    renderPage('/a2a/new');

    await userEvent.type(screen.getByLabelText('Name'), 'Remote');
    await userEvent.type(screen.getByLabelText('Base URL'), 'https://remote.example');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect((await screen.findByRole('status')).textContent).toContain('The tenant ID is not valid.');
  });
});

vi.mock('../services/a2a-module', () => ({ a2aStatus: { subscribe: () => () => undefined, getState: () => false }, a2aModuleService: { settings: vi.fn(async () => ({ serverEnabled: false, clientEnabled: true })), outboundIps: vi.fn(async () => ({ entries: [] })) } }));

vi.mock('./shell-header', () => ({ ShellFooter: () => <div>Settings navigation</div> }));
