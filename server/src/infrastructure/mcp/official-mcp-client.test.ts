import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { McpServer } from '../../application/ports/mcp-repo.js';
import { OfficialMcpClientFactory } from './official-mcp-client.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function configured(patch: Partial<McpServer> = {}): McpServer {
  const cwd = mkdtempSync(join(tmpdir(), 'pop-official-mcp-'));
  roots.push(cwd);
  return {
    id: 'mcp-test', name: 'test', description: '', transport: 'streamable-http',
    endpoint: '', command: '', args: [], authKind: 'none', authHeader: '', enabled: true,
    timeoutMs: 2_000, status: 'unknown', lastError: '', cwd, createdAt: 'T', updatedAt: 'T',
    ...patch,
  };
}

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array));
  const text = Buffer.concat(chunks).toString();
  return text.length === 0 ? {} : JSON.parse(text) as Record<string, unknown>;
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
}

async function httpFixture(
  handler: (request: IncomingMessage, response: ServerResponse, message: Record<string, unknown>) => void,
): Promise<{ url: string; close(): Promise<void> }> {
  const server = createServer((request, response) => {
    void body(request).then((message) => handler(request, response, message));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no test address');
  return {
    url: `http://127.0.0.1:${String(address.port)}/mcp`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    }),
  };
}

function result(message: Record<string, unknown>, value: unknown) {
  return { jsonrpc: '2.0', id: message['id'], result: value };
}

describe('official MCP SDK adapter', () => {
  it('negotiates modern stateless HTTP and attaches per-request metadata', async () => {
    const seen: Array<{ method: string; headers: IncomingMessage['headers']; params: unknown }> = [];
    const fixture = await httpFixture((request, response, message) => {
      const method = String(message['method']);
      seen.push({ method, headers: request.headers, params: message['params'] });
      if (method === 'server/discover') {
        json(response, 200, result(message, {
          supportedVersions: ['2026-07-28'],
          capabilities: { tools: {}, resources: {}, prompts: {} },
        }));
      } else if (method === 'tools/list') {
        json(response, 200, result(message, { resultType: 'complete', ttlMs: 0, cacheScope: 'private', tools: [
          { name: 'weather', description: 'Forecast', inputSchema: { type: 'object', properties: { region: { type: 'string', 'x-mcp-header': 'Region' } } } },
        ] }));
      } else if (method === 'resources/list') {
        json(response, 200, result(message, { resultType: 'complete', ttlMs: 0, cacheScope: 'private', resources: [
          { uri: 'file:///guide', name: 'guide', description: 'Guide' },
        ] }));
      } else if (method === 'resources/templates/list') {
        json(response, 200, result(message, { resultType: 'complete', ttlMs: 0, cacheScope: 'private', resourceTemplates: [
          { uriTemplate: 'file:///{name}', name: 'documents' },
        ] }));
      } else if (method === 'prompts/list') {
        json(response, 200, result(message, { resultType: 'complete', ttlMs: 0, cacheScope: 'private', prompts: [
          { name: 'summarize', arguments: [{ name: 'tone', required: true }] },
        ] }));
      } else if (method === 'tools/call') {
        json(response, 200, result(message, { resultType: 'complete', content: [{ type: 'text', text: 'sunny' }] }));
      } else {
        json(response, 404, { jsonrpc: '2.0', id: message['id'], error: { code: -32601, message: 'missing' } });
      }
    });

    const factory = new OfficialMcpClientFactory();
    const server = configured({ endpoint: fixture.url, authKind: 'bearer' });
    try {
      const connection = await factory.connect(
        server,
        JSON.stringify({ MCP_SECRET: 'secret-token' }),
      );
      expect(connection.protocolEra).toBe('modern');
      expect(connection.protocolVersion).toBe('2026-07-28');
      const capabilities = await connection.capabilities();
      expect(capabilities).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'tool', name: 'weather' }),
        expect.objectContaining({ kind: 'resource', name: 'file:///guide' }),
        expect.objectContaining({ kind: 'resource', name: 'file:///{name}' }),
        expect.objectContaining({
          kind: 'prompt',
          name: 'summarize',
          inputSchema: expect.objectContaining({ required: ['tone'] }),
        }),
      ]));
      expect(await connection.callTool('weather', { region: 'São Paulo' })).toMatchObject({
        content: [{ text: 'sunny' }],
      });
      await connection.close();
      // The second short-lived connection reuses the era verdict instead of
      // probing/spawning again for every tool invocation.
      const second = await factory.connect(server, JSON.stringify({ MCP_SECRET: 'secret-token' }));
      await second.callTool('weather', { region: 'São Paulo' });
      await second.close();
    } finally {
      await fixture.close();
    }

    expect(seen.filter((entry) => entry.method === 'server/discover')).toHaveLength(1);
    expect(seen.map((entry) => entry.method)).not.toContain('initialize');
    for (const entry of seen) {
      expect(entry.headers['authorization']).toBe('Bearer secret-token');
      expect(entry.headers['mcp-protocol-version']).toBe('2026-07-28');
      expect((entry.params as { _meta?: Record<string, unknown> } | undefined)?._meta).toHaveProperty(
        'io.modelcontextprotocol/protocolVersion',
        '2026-07-28',
      );
      expect(entry.headers['mcp-session-id']).toBeUndefined();
    }
    const calls = seen.filter((entry) => entry.method === 'tools/call');
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.headers['mcp-name']).toBe('weather');
      expect(call.headers['mcp-param-region']).toBe('=?base64?U8OjbyBQYXVsbw==?=');
    }
  });

  it('cancels a modern HTTP tool by closing its request stream', async () => {
    let requestStarted = (): void => undefined;
    const started = new Promise<void>((resolve) => { requestStarted = resolve; });
    let requestClosed = (): void => undefined;
    const closed = new Promise<void>((resolve) => { requestClosed = resolve; });
    const fixture = await httpFixture((_request, response, message) => {
      if (message['method'] === 'server/discover') {
        json(response, 200, result(message, {
          supportedVersions: ['2026-07-28'], capabilities: { tools: {} },
        }));
        return;
      }
      if (message['method'] === 'tools/call') {
        requestStarted();
        response.on('close', requestClosed);
      }
    });
    const connection = await new OfficialMcpClientFactory().connect(
      configured({ endpoint: fixture.url }),
      undefined,
    );
    const controller = new AbortController();
    const call = connection.callTool(
      'slow',
      {},
      { kind: 'tool', name: 'slow', description: '', inputSchema: { type: 'object' }, metadata: {} },
      controller.signal,
    );
    await started;
    controller.abort();

    await expect(call).rejects.toThrow();
    await closed;
    await connection.close();
    await fixture.close();
  });

  it('falls back to the legacy initialize handshake on Streamable HTTP', async () => {
    const methods: string[] = [];
    const fixture = await httpFixture((_request, response, message) => {
      const method = String(message['method']);
      methods.push(method);
      if (method === 'server/discover') {
        json(response, 400, { jsonrpc: '2.0', id: message['id'], error: { code: -32601, message: 'unknown' } });
      } else if (method === 'initialize') {
        json(response, 200, result(message, {
          protocolVersion: '2025-03-26',
          capabilities: { tools: {} },
          serverInfo: { name: 'legacy-test', version: '1.0.0' },
        }));
      } else if (method === 'notifications/initialized') {
        response.writeHead(202).end();
      } else if (method === 'tools/list') {
        json(response, 200, result(message, { tools: [] }));
      } else {
        json(response, 404, { jsonrpc: '2.0', id: message['id'], error: { code: -32601, message: 'missing' } });
      }
    });

    try {
      const connection = await new OfficialMcpClientFactory().connect(
        configured({ endpoint: fixture.url }),
        undefined,
      );
      expect(connection.protocolEra).toBe('legacy');
      expect(connection.protocolVersion).toBe('2025-03-26');
      expect(await connection.capabilities()).toEqual([]);
      await connection.close();
    } finally {
      await fixture.close();
    }
    expect(methods).toEqual(expect.arrayContaining(['server/discover', 'initialize', 'tools/list']));
  });

  it('handles fragmented stdio replies and reaps the child through the SDK', async () => {
    const server = configured({ transport: 'stdio', command: process.execPath, endpoint: '' });
    const script = join(server.cwd, 'server.mjs');
    writeFileSync(script, `
import readline from 'node:readline';
const lines = readline.createInterface({ input: process.stdin });
lines.on('line', (line) => {
  const request = JSON.parse(line);
  let result;
  if (request.method === 'server/discover') result = { supportedVersions: ['2026-07-28'], capabilities: { tools: {} } };
  else if (request.method === 'tools/list') result = { resultType: 'complete', ttlMs: 0, cacheScope: 'private', tools: [{ name: (process.env.POP_AGENT_SHOULD_NOT_LEAK ?? 'isolated') + ':' + (process.env.ONLY_MCP ?? 'missing'), inputSchema: { type: 'object' } }] };
  else result = { resultType: 'complete', content: [] };
  const response = JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\\n';
  process.stderr.write('diagnostic\\n');
  const middle = Math.floor(response.length / 2);
  process.stdout.write(response.slice(0, middle));
  setTimeout(() => process.stdout.write(response.slice(middle)), 5);
});
`);
    server.args = [script];

    process.env['POP_AGENT_SHOULD_NOT_LEAK'] = 'host-secret';
    const connection = await new OfficialMcpClientFactory().connect(
      server,
      JSON.stringify({ ONLY_MCP: 'child-value' }),
    );
    try {
      expect(connection.protocolEra).toBe('modern');
      expect(await connection.capabilities()).toContainEqual(
        expect.objectContaining({ name: 'isolated:child-value' }),
      );
    } finally {
      delete process.env['POP_AGENT_SHOULD_NOT_LEAK'];
      await connection.close();
    }
  });

  it('turns a missing stdio executable into a rejected connection', async () => {
    const server = configured({ transport: 'stdio', command: join('/missing', 'mcp'), endpoint: '' });
    await expect(new OfficialMcpClientFactory().connect(server, undefined)).rejects.toThrow();
  });
});
