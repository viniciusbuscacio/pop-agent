import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Hono } from 'hono';
import type { McpClientFactory } from '../../application/ports/mcp-client.js';
import { createTestApp, setupTestSession } from '../../testing/app-fixture.js';

let app: Hono;
let token: string;
const connect = vi.fn<McpClientFactory['connect']>();

async function api(path: string, options: { method?: string; body?: unknown } = {}) {
  return app.request(path, {
    method: options.method ?? 'GET',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
}

beforeEach(async () => {
  connect.mockReset();
  connect.mockResolvedValue({
    protocolEra: 'modern',
    protocolVersion: '2026-07-28',
    capabilities: () => Promise.resolve([
      { kind: 'tool', name: 'weather', description: '', inputSchema: { type: 'object' }, metadata: {} },
    ]),
    callTool: () => Promise.resolve({ content: [] }),
    close: () => Promise.resolve(),
  });
  app = createTestApp(undefined, { mcpClients: { connect } }).app;
  token = await setupTestSession(app);
});

describe('MCP routes', () => {
  it('keeps every endpoint behind the session guard', async () => {
    for (const [path, method] of [
      ['/v1/mcp/servers', 'GET'],
      ['/v1/mcp/servers', 'POST'],
      ['/v1/mcp/servers/missing', 'PUT'],
      ['/v1/mcp/servers/missing', 'DELETE'],
      ['/v1/mcp/servers/missing/test', 'POST'],
      ['/v1/mcp/servers/missing/toggle', 'POST'],
    ] as const) {
      const response = await app.request(path, { method });
      expect(response.status, `${method} ${path}`).toBe(401);
    }
  });

  it('returns the negotiated stateless era and version after Test connection', async () => {
    const created = await api('/v1/mcp/servers', {
      method: 'POST',
      body: {
        name: 'Modern server',
        transport: 'streamable-http',
        endpoint: 'https://example.test/mcp',
      },
    });
    const id = ((await created.json()) as { server: { id: string } }).server.id;

    const tested = await api(`/v1/mcp/servers/${id}/test`, { method: 'POST' });

    expect(tested.status).toBe(200);
    expect(await tested.json()).toMatchObject({
      server: {
        protocolEra: 'modern',
        protocolVersion: '2026-07-28',
        status: 'connected',
      },
      capabilities: [{ kind: 'tool', name: 'weather' }],
    });
  });

  it('validates transports, URLs, headers, environment names, and unknown fields', async () => {
    for (const body of [
      { name: 'stdio', transport: 'stdio' },
      { name: 'HTTP', transport: 'streamable-http', endpoint: 'file:///tmp/socket' },
      { name: 'HTTP', transport: 'sse', endpoint: 'https://user:secret@example.test' },
      { name: 'HTTP', transport: 'streamable-http', endpoint: 'https://example.test', authKind: 'custom-header' },
      { name: 'HTTP', transport: 'streamable-http', endpoint: 'https://example.test', authHeader: 'Host' },
      { name: 'stdio', transport: 'stdio', command: 'node', env: { 'BAD-NAME': 'secret' } },
      { name: 'HTTP', transport: 'streamable-http', endpoint: 'https://example.test', typo: true },
    ]) {
      const response = await api('/v1/mcp/servers', { method: 'POST', body });
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: 'invalid_field' } });
    }
  });

  it('never returns credentials and supports explicitly clearing them', async () => {
    const created = await api('/v1/mcp/servers', {
      method: 'POST',
      body: {
        name: 'Private server',
        transport: 'streamable-http',
        endpoint: 'https://example.test/mcp',
        authKind: 'bearer',
        env: { MCP_SECRET: 'top-secret' },
      },
    });
    const createdBody = await created.json() as { server: { id: string; hasCredential: boolean } };
    expect(createdBody.server.hasCredential).toBe(true);
    expect(JSON.stringify(createdBody)).not.toContain('top-secret');

    const cleared = await api(`/v1/mcp/servers/${createdBody.server.id}`, {
      method: 'PUT',
      body: { env: null },
    });
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toMatchObject({ server: { hasCredential: false } });
  });

  it('uses stable not-found errors and sanitizes connection diagnostics', async () => {
    const missing = await api('/v1/mcp/servers/missing/test', { method: 'POST' });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({
      error: { code: 'mcp_server_not_found', message: 'No such MCP server.', status: 404 },
    });

    const created = await api('/v1/mcp/servers', {
      method: 'POST',
      body: {
        name: 'Broken server',
        transport: 'streamable-http',
        endpoint: 'https://example.test/mcp',
      },
    });
    const id = ((await created.json()) as { server: { id: string } }).server.id;
    connect.mockRejectedValueOnce(
      new Error('Bearer top-secret failed at /home/owner/.pop-agent/secret.key'),
    );

    const tested = await api(`/v1/mcp/servers/${id}/test`, { method: 'POST' });
    expect(tested.status).toBe(502);
    expect(await tested.json()).toEqual({
      error: {
        code: 'mcp_unavailable',
        message: 'The MCP server could not be reached.',
        status: 502,
      },
    });
    const listed = await api('/v1/mcp/servers');
    const listedText = JSON.stringify(await listed.json());
    expect(listedText).not.toContain('top-secret');
    expect(listedText).not.toContain('/home/owner');
    expect(listedText).toContain('The MCP server could not be reached.');
  });
});
