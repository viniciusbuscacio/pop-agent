import type { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp } from '../../testing/app-fixture.js';
import type { A2aHttpService } from './a2a-routes.js';

const agent = {
  id: 'agent-1',
  name: 'Weather agent',
  description: 'Remote forecasts',
  baseUrl: 'https://agent.test/a2a',
  agentCardPath: '.well-known/agent-card.json',
  authKind: 'bearer' as const,
  authHeader: '',
  entraTenantId: '',
  entraClientId: '',
  entraScope: '',
  hasCredential: true,
  enabled: true,
  timeoutMs: 10_000,
  status: 'connected' as const,
  lastError: 'Bearer top-secret failed at /home/owner/.pop-agent/secret.key',
  lastConnectedAt: '2026-01-02T03:04:05.000Z',
  protocolVersion: '0.3.0',
  agentVersion: '1.2.3',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T03:04:05.000Z',
  interfaces: [{
    id: 'interface-1',
    agentId: 'agent-1',
    url: 'https://agent.test/a2a',
    protocolBinding: 'JSONRPC',
    protocolVersion: '0.3.0',
    updatedAt: '2026-01-02T03:04:05.000Z',
  }],
  skills: [{
    id: 'skill-1',
    agentId: 'agent-1',
    remoteSkillId: 'weather',
    name: 'Weather',
    description: 'Forecasts',
    tags: ['weather'],
    examples: ['Weather in Rio'],
    inputModes: ['text/plain'],
    outputModes: ['text/plain'],
    updatedAt: '2026-01-02T03:04:05.000Z',
  }],
};

const task = {
  id: 'task-1',
  agentId: agent.id,
  remoteTaskId: 'remote-1',
  contextId: 'context-1',
  state: 'working' as const,
  requestText: 'Weather in Rio',
  responseText: '',
  createdAt: '2026-01-02T03:05:00.000Z',
  updatedAt: '2026-01-02T03:05:00.000Z',
};

let app: Hono;
let token: string;
let service: A2aHttpService;

async function api(path: string, options: { method?: string; body?: unknown } = {}) {
  return app.request(path, {
    method: options.method ?? 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
}

beforeEach(async () => {
  service = {
    list: vi.fn(() => [agent]),
    get: vi.fn((id) => id === agent.id ? agent : undefined),
    create: vi.fn((input) => ({ ...agent, ...input })),
    update: vi.fn((id, input) => id === agent.id ? { ...agent, ...input } : undefined),
    delete: vi.fn((id) => id === agent.id),
    test: vi.fn(() => Promise.resolve(agent)),
    listTasks: vi.fn(() => [task]),
    task: vi.fn((id) => id === task.id ? task : undefined),
    sendText: vi.fn(() => Promise.resolve(task)),
    getTask: vi.fn(() => Promise.resolve({ ...task, state: 'completed' as const, responseText: 'Sunny' })),
    cancelTask: vi.fn(() => Promise.resolve({ ...task, state: 'canceled' as const })),
    continueTask: vi.fn(() => Promise.resolve({ ...task, responseText: 'Continuing' })),
  };
  app = createTestApp(undefined, { a2a: service }).app;
  const setup = await app.request('/v1/setup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'correct horse battery' }),
  });
  token = ((await setup.json()) as { token: string }).token;
});

describe('outbound A2A routes', () => {
  it('keeps every A2A endpoint behind the session guard', async () => {
    for (const [path, method] of [
      ['/v1/a2a/agents', 'GET'],
      ['/v1/a2a/agents', 'POST'],
      ['/v1/a2a/agents/agent-1', 'PUT'],
      ['/v1/a2a/agents/agent-1', 'DELETE'],
      ['/v1/a2a/agents/agent-1/test', 'POST'],
      ['/v1/a2a/agents/agent-1/toggle', 'POST'],
      ['/v1/a2a/tasks', 'GET'],
      ['/v1/a2a/agents/agent-1/messages', 'POST'],
      ['/v1/a2a/tasks/task-1', 'GET'],
      ['/v1/a2a/tasks/task-1/cancel', 'POST'],
      ['/v1/a2a/tasks/task-1/continue', 'POST'],
    ] as const) {
      const response = await app.request(path, { method });
      expect(response.status, `${method} ${path}`).toBe(401);
    }
  });

  it('maps agent discovery data without returning credentials or internal errors', async () => {
    const response = await api('/v1/a2a/agents');

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      agents: [{
        id: agent.id,
        hasCredential: true,
        protocolVersion: '0.3.0',
        interfaces: [{ id: 'interface-1', protocolBinding: 'JSONRPC' }],
        skills: [{ id: 'skill-1', remoteSkillId: 'weather' }],
      }],
    });
    expect(JSON.stringify(body)).not.toContain('credential');
    expect(body.agents[0]).toMatchObject({
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T03:04:05.000Z',
    });
    expect(JSON.stringify(body)).not.toContain('top-secret');
    expect(JSON.stringify(body)).not.toContain('/home/owner');
  });

  it('validates bounded agent configuration with strict schemas', async () => {
    const created = await api('/v1/a2a/agents', {
      method: 'POST',
      body: {
        name: 'Remote agent',
        baseUrl: 'https://remote.test/a2a',
        credential: 'top-secret',
      },
    });
    expect(created.status).toBe(201);
    expect(service.create).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Remote agent',
      timeoutMs: 60_000,
      credential: 'top-secret',
    }));
    expect(JSON.stringify(await created.json())).not.toContain('top-secret');

    const foundry = await api('/v1/a2a/agents', {
      method: 'POST',
      body: {
        name: 'Foundry agent',
        baseUrl: 'https://foundry.test/a2a',
        agentCardPath: 'agentCard/v1.0',
        authKind: 'microsoft-entra',
        entraTenantId: '0269f5ec-2243-438f-90ec-7a4b9c20ca9c',
        entraClientId: '9595bd7c-fa1a-4091-85fc-09546dc1306c',
        entraScope: 'https://ai.azure.com/.default',
        credential: 'client-secret',
      },
    });
    expect(foundry.status).toBe(201);
    expect(service.create).toHaveBeenLastCalledWith(expect.objectContaining({
      agentCardPath: 'agentCard/v1.0', authKind: 'microsoft-entra',
      entraScope: 'https://ai.azure.com/.default', credential: 'client-secret',
    }));
    expect(JSON.stringify(await foundry.json())).not.toContain('client-secret');

    const unknown = await api('/v1/a2a/agents', {
      method: 'POST',
      body: { name: 'Remote', baseUrl: 'https://remote.test', typo: true },
    });
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toMatchObject({ error: { code: 'invalid_field' } });

    for (const invalid of [
      { name: 'Remote', baseUrl: 'file:///tmp/internal' },
      { name: 'Remote', baseUrl: 'http://remote.test' },
      { name: 'Remote', baseUrl: 'https://user:secret@remote.test' },
      { name: 'Remote', baseUrl: 'https://remote.test', timeoutMs: 999 },
      { name: 'Remote', baseUrl: 'https://remote.test', authHeader: 'X-Test\r\nLeak' },
      { name: 'Remote', baseUrl: 'https://remote.test', authHeader: 'Host' },
      { name: 'Remote', baseUrl: 'https://remote.test', agentCardPath: 'https://evil.test/card' },
      { name: 'Remote', baseUrl: 'https://remote.test', agentCardPath: '../card' },
    ]) {
      const response = await api('/v1/a2a/agents', { method: 'POST', body: invalid });
      expect(response.status, JSON.stringify(invalid)).toBe(400);
    }
  });

  it('supports update, delete, test, and toggle with stable not-found behavior', async () => {
    expect((await api('/v1/a2a/agents/agent-1', {
      method: 'PUT',
      body: { description: 'Updated', credential: null },
    })).status).toBe(200);
    expect(service.update).toHaveBeenCalledWith('agent-1', {
      description: 'Updated',
      credential: null,
    });

    expect((await api('/v1/a2a/agents/agent-1/test', { method: 'POST' })).status).toBe(200);
    expect((await api('/v1/a2a/agents/agent-1/toggle', { method: 'POST' })).status).toBe(200);
    expect(service.update).toHaveBeenLastCalledWith('agent-1', { enabled: false });
    expect((await api('/v1/a2a/agents/agent-1', { method: 'DELETE' })).status).toBe(204);

    const missing = await api('/v1/a2a/agents/missing/test', { method: 'POST' });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({
      error: { code: 'a2a_agent_not_found', message: 'No such A2A agent.', status: 404 },
    });
  });

  it('maps task list, send, refresh, cancel, and continue operations', async () => {
    const listed = await api('/v1/a2a/tasks?agentId=agent-1');
    expect(listed.status).toBe(200);
    expect(await listed.json()).toMatchObject({ tasks: [{ id: task.id, state: 'working' }] });
    expect(service.listTasks).toHaveBeenCalledWith('agent-1');

    const sent = await api('/v1/a2a/agents/agent-1/messages', {
      method: 'POST',
      body: { text: 'Weather in Rio' },
    });
    expect(sent.status).toBe(201);
    expect(service.sendText).toHaveBeenCalledWith('agent-1', 'Weather in Rio', expect.any(AbortSignal));

    const refreshed = await api('/v1/a2a/tasks/task-1');
    expect(refreshed.status).toBe(200);
    expect(await refreshed.json()).toMatchObject({ task: { state: 'completed', responseText: 'Sunny' } });

    expect((await api('/v1/a2a/tasks/task-1/cancel', { method: 'POST' })).status).toBe(200);
    expect((await api('/v1/a2a/tasks/task-1/continue', {
      method: 'POST',
      body: { text: 'Add tomorrow' },
    })).status).toBe(200);
    expect(service.continueTask).toHaveBeenCalledWith(
      'task-1',
      'Add tomorrow',
      expect.any(AbortSignal),
    );
  });

  it('rejects unknown query/body fields and unbounded task text', async () => {
    const query = await api('/v1/a2a/tasks?unexpected=true');
    expect(query.status).toBe(400);
    expect(await query.json()).toMatchObject({ error: { code: 'invalid_field' } });

    const body = await api('/v1/a2a/tasks/task-1/continue', {
      method: 'POST',
      body: { text: 'ok', unexpected: true },
    });
    expect(body.status).toBe(400);

    const tooLong = await api('/v1/a2a/agents/agent-1/messages', {
      method: 'POST',
      body: { text: 'x'.repeat(100_001) },
    });
    expect(tooLong.status).toBe(400);
  });

  it('never copies service errors, secrets, or internal paths into API errors', async () => {
    vi.mocked(service.test).mockRejectedValueOnce(
      new Error('Bearer top-secret failed at /home/owner/.pop-agent/secret.key'),
    );

    const response = await api('/v1/a2a/agents/agent-1/test', { method: 'POST' });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: {
        code: 'a2a_unavailable',
        message: 'The A2A agent could not be reached.',
        status: 502,
      },
    });
  });
});
