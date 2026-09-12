import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpClientFactory, McpConnection } from '../ports/mcp-client.js';
import type { McpCapability, McpRepo, McpServer } from '../ports/mcp-repo.js';
import type { SecretsRepo } from '../ports/secrets-repo.js';
import { McpService } from './mcp-service.js';

class MemoryMcpRepo implements McpRepo {
  server: McpServer | undefined;
  savedCapabilities: McpCapability[] = [];
  list(): McpServer[] { return this.server === undefined ? [] : [this.server]; }
  get(id: string): McpServer | undefined { return this.server?.id === id ? this.server : undefined; }
  create(server: McpServer): McpServer { this.server = server; return server; }
  update(id: string, patch: Partial<McpServer>): McpServer | undefined {
    if (this.server?.id !== id) return undefined;
    this.server = { ...this.server, ...patch };
    return this.server;
  }
  delete(id: string): boolean {
    if (this.server?.id !== id) return false;
    this.server = undefined;
    return true;
  }
  capabilities(): McpCapability[] { return this.savedCapabilities; }
  replaceCapabilities(_serverId: string, capabilities: McpCapability[]): void {
    this.savedCapabilities = capabilities;
  }
}

class MemorySecrets implements SecretsRepo {
  private readonly values = new Map<string, string>();
  get(key: string): string | undefined { return this.values.get(key); }
  set(key: string, value: string): void { this.values.set(key, value); }
  delete(key: string): void { this.values.delete(key); }
}

let root: string;
let repo: MemoryMcpRepo;
let connection: McpConnection;
let connect: ReturnType<typeof vi.fn<McpClientFactory['connect']>>;
let service: McpService;
let secrets: MemorySecrets;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pop-mcp-test-'));
  repo = new MemoryMcpRepo();
  connection = {
    protocolEra: 'modern',
    protocolVersion: '2026-07-28',
    capabilities: vi.fn(() => Promise.resolve([
      { kind: 'tool' as const, name: 'weather', description: 'Forecast', inputSchema: { type: 'object' }, metadata: {} },
    ])),
    callTool: vi.fn(() => Promise.resolve({ content: [{ type: 'text', text: 'sunny' }] })),
    close: vi.fn(() => Promise.resolve()),
  };
  connect = vi.fn(() => Promise.resolve(connection));
  secrets = new MemorySecrets();
  service = new McpService({
    repo,
    secrets,
    clients: { connect },
    dataDir: root,
  });
  repo.server = stdioServer();
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function stdioServer(): McpServer {
  return {
    id: 'mcp-test', name: 'test', description: '', transport: 'stdio', endpoint: '',
    command: process.execPath, args: [], authKind: 'none', authHeader: '', enabled: true,
    timeoutMs: 2_000, status: 'unknown', lastError: '', cwd: root, createdAt: 'T', updatedAt: 'T',
  };
}

describe('McpService', () => {
  it('persists capabilities and the negotiated stateless protocol era', async () => {
    const result = await service.test('mcp-test');

    expect(result.server).toMatchObject({
      status: 'connected',
      protocolEra: 'modern',
      protocolVersion: '2026-07-28',
    });
    expect(result.capabilities[0]).toMatchObject({ name: 'weather', serverId: 'mcp-test' });
    expect(connection.close).toHaveBeenCalledOnce();
  });

  it('closes the SDK connection after a tool call', async () => {
    await service.test('mcp-test');
    vi.mocked(connection.close).mockClear();
    const signal = new AbortController().signal;
    expect(JSON.parse(await service.callTool('mcp-test', 'weather', { city: 'Rio' }, signal))).toMatchObject({
      content: [{ text: 'sunny' }],
    });
    expect(connection.callTool).toHaveBeenCalledWith(
      'weather',
      { city: 'Rio' },
      expect.objectContaining({ name: 'weather', inputSchema: { type: 'object' } }),
      signal,
    );
    expect(connection.close).toHaveBeenCalledOnce();
  });

  it('records a normal error when SDK connection fails', async () => {
    connect.mockRejectedValueOnce(new Error('spawn ENOENT'));

    await expect(service.test('mcp-test')).rejects.toThrow('spawn ENOENT');
    expect(repo.server).toMatchObject({ status: 'error', lastError: 'spawn ENOENT' });
  });

  it('does not create orphaned secrets while updating a missing server', () => {
    expect(service.update('missing', { env: { MCP_SECRET: 'top-secret' } })).toBeUndefined();
    expect(secrets.get(McpService.secretKey('missing'))).toBeUndefined();
  });
});
