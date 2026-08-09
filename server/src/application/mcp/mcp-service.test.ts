import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { McpCapability, McpRepo, McpServer } from '../ports/mcp-repo.js';
import type { SecretsRepo } from '../ports/secrets-repo.js';
import { McpService } from './mcp-service.js';

class MemoryMcpRepo implements McpRepo {
  server: McpServer | undefined;
  savedCapabilities: McpCapability[] = [];

  list(): McpServer[] {
    return this.server === undefined ? [] : [this.server];
  }
  get(id: string): McpServer | undefined {
    return this.server?.id === id ? this.server : undefined;
  }
  create(server: McpServer): McpServer {
    this.server = server;
    return server;
  }
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
  capabilities(): McpCapability[] {
    return this.savedCapabilities;
  }
  replaceCapabilities(_serverId: string, capabilities: McpCapability[]): void {
    this.savedCapabilities = capabilities;
  }
}

class MemorySecrets implements SecretsRepo {
  private readonly values = new Map<string, string>();
  get(key: string): string | undefined {
    return this.values.get(key);
  }
  set(key: string, value: string): void {
    this.values.set(key, value);
  }
  delete(key: string): void {
    this.values.delete(key);
  }
}

let root: string;
let repo: MemoryMcpRepo;
let service: McpService;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pop-mcp-test-'));
  repo = new MemoryMcpRepo();
  service = new McpService({ repo, secrets: new MemorySecrets(), dataDir: root });
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function stdioServer(command: string, args: string[] = []): McpServer {
  return {
    id: 'mcp-test',
    name: 'test',
    description: '',
    transport: 'stdio',
    endpoint: '',
    command,
    args,
    authKind: 'none',
    authHeader: '',
    enabled: true,
    timeoutMs: 2_000,
    status: 'unknown',
    lastError: '',
    cwd: root,
    createdAt: 'T',
    updatedAt: 'T',
  };
}

describe('McpService stdio transport', () => {
  it('turns a missing executable into a normal failed test instead of crashing Node', async () => {
    repo.server = stdioServer(join(root, 'does-not-exist'));

    await expect(service.test(repo.server.id)).rejects.toThrow(/ENOENT/);
    expect(repo.server.status).toBe('error');
  });

  it('assembles JSON-RPC replies split across stdout chunks and drains diagnostics', async () => {
    const script = join(root, 'server.mjs');
    writeFileSync(
      script,
      `import readline from 'node:readline';
const lines = readline.createInterface({ input: process.stdin });
lines.on('line', (line) => {
  const request = JSON.parse(line);
  process.stderr.write('diagnostic\\n');
  const result = request.method === 'initialize'
    ? { protocolVersion: '2025-03-26' }
    : { tools: [{ name: 'weather', description: 'Forecast', inputSchema: { type: 'object' } }] };
  const response = JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\\n';
  const middle = Math.floor(response.length / 2);
  process.stdout.write(response.slice(0, middle));
  setTimeout(() => process.stdout.write(response.slice(middle)), 5);
});
`,
    );
    repo.server = stdioServer(process.execPath, [script]);

    const result = await service.test(repo.server.id);

    expect(result.server.status).toBe('connected');
    expect(result.capabilities).toHaveLength(1);
    expect(result.capabilities[0]).toMatchObject({ name: 'weather', description: 'Forecast' });
  });
});
