import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Hono } from 'hono';
import type { McpClientFactory } from '../../application/ports/mcp-client.js';
import { createTestApp } from '../../testing/app-fixture.js';

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
  const setup = await app.request('/v1/setup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'correct horse battery' }),
  });
  token = ((await setup.json()) as { token: string }).token;
});

describe('MCP routes', () => {
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
});
