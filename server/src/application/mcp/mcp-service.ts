import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { entityId } from '../../domain/ids.js';
import type { SecretsRepo } from '../ports/secrets-repo.js';
import type { McpCapability, McpRepo, McpServer } from '../ports/mcp-repo.js';

export class McpService {
  constructor(private readonly deps: { repo: McpRepo; secrets: SecretsRepo; dataDir: string }) {}

  list(): Array<McpServer & { capabilities: McpCapability[] }> {
    return this.deps.repo
      .list()
      .map((server) => ({ ...server, capabilities: this.deps.repo.capabilities(server.id) }));
  }

  get(id: string): (McpServer & { capabilities: McpCapability[] }) | undefined {
    const server = this.deps.repo.get(id);
    return server === undefined
      ? undefined
      : { ...server, capabilities: this.deps.repo.capabilities(id) };
  }

  create(
    input: Omit<McpServer, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'lastError' | 'cwd'> & {
      env?: Record<string, string> | undefined;
    },
  ): McpServer {
    const now = new Date().toISOString();
    const id = entityId('mcp');
    const cwd = join(this.deps.dataDir, 'mcp', id);
    mkdirSync(cwd, { recursive: true });
    const { env, ...fields } = input;
    const server: McpServer = {
      ...fields,
      id,
      cwd,
      status: 'unknown',
      lastError: '',
      createdAt: now,
      updatedAt: now,
    };
    this.deps.repo.create(server);
    this.saveSecrets(id, env);
    return server;
  }

  update(
    id: string,
    patch: { [K in keyof McpServer]?: McpServer[K] | undefined } & {
      env?: Record<string, string> | undefined;
    },
  ): McpServer | undefined {
    if (patch.env !== undefined) this.saveSecrets(id, patch.env);
    const rest = { ...patch };
    delete (rest as { env?: Record<string, string> }).env;
    return this.deps.repo.update(id, rest);
  }

  delete(id: string): boolean {
    this.deps.secrets.delete(secretKey(id));
    return this.deps.repo.delete(id);
  }

  async test(id: string): Promise<{ server: McpServer; capabilities: McpCapability[] }> {
    const server = this.deps.repo.get(id);
    if (server === undefined) throw new Error('No such MCP server.');
    const client = new SimpleMcpClient(server, this.deps.secrets.get(secretKey(id)));
    try {
      await client.initialize();
      const capabilities = await client.capabilities();
      this.deps.repo.replaceCapabilities(id, capabilities);
      const updated = this.deps.repo.update(id, {
        status: 'connected',
        lastError: '',
        lastConnectedAt: new Date().toISOString(),
      })!;
      return { server: updated, capabilities };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'MCP connection failed';
      const updated = this.deps.repo.update(id, { status: 'error', lastError: message })!;
      throw Object.assign(new Error(message), { server: updated });
    } finally {
      await client.close();
    }
  }

  secret(id: string): string | undefined {
    return this.deps.secrets.get(secretKey(id));
  }

  async callTool(serverId: string, name: string, args: Record<string, unknown>): Promise<string> {
    const server = this.deps.repo.get(serverId);
    if (server === undefined || !server.enabled) {
      throw new Error('MCP server is disabled or missing.');
    }
    const client = new SimpleMcpClient(server, this.deps.secrets.get(secretKey(serverId)));
    try {
      await client.initialize();
      const result = await client.callTool(name, args);
      return JSON.stringify(result);
    } finally {
      await client.close();
    }
  }

  private saveSecrets(id: string, env: Record<string, string> | undefined): void {
    if (env !== undefined) this.deps.secrets.set(secretKey(id), JSON.stringify(env));
  }

  static secretKey(id: string): string {
    return secretKey(id);
  }
}

function secretKey(id: string): string {
  return `mcp:${id}:env`;
}

class SimpleMcpClient {
  constructor(
    private readonly server: McpServer,
    private readonly envJson: string | undefined,
  ) {}

  private id = 0;
  private child: ChildProcessWithoutNullStreams | undefined;

  async initialize(): Promise<void> {
    const result = await this.request('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'pop', version: '0.2.0' },
    });
    if (result === undefined) throw new Error('MCP initialize returned no result');
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.request('tools/call', { name, arguments: args });
  }

  async capabilities(): Promise<McpCapability[]> {
    const result = await this.request('tools/list', {});
    const raw = (result as { tools?: unknown[] } | undefined)?.tools ?? [];
    return raw
      .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
      .map((entry) => ({
        id: entityId('mcp-capability'),
        serverId: this.server.id,
        kind: 'tool',
        name: String(entry['name'] ?? ''),
        description: String(entry['description'] ?? ''),
        inputSchema: (entry['inputSchema'] as Record<string, unknown>) ?? {},
        metadata: {},
        updatedAt: new Date().toISOString(),
      }));
  }

  async close(): Promise<void> {
    if (this.child !== undefined) {
      this.child.kill('SIGTERM');
      this.child = undefined;
    }
  }

  private async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (this.server.transport === 'stdio') return this.stdio(method, params);

    const headers = new Headers({
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    });
    const secret = this.envJson;
    if (secret !== undefined) {
      try {
        const parsed = JSON.parse(secret) as Record<string, string>;
        const value = parsed['token'] ?? parsed['value'] ?? Object.values(parsed)[0];
        if (value !== undefined) {
          headers.set(
            this.server.authHeader ||
              (this.server.authKind === 'bearer' ? 'authorization' : 'x-api-key'),
            this.server.authKind === 'bearer' ? `Bearer ${value}` : value,
          );
        }
      } catch {
        // A malformed optional secret is equivalent to no secret.
      }
    }
    const response = await fetch(this.server.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: ++this.id, method, params }),
      signal: AbortSignal.timeout(this.server.timeoutMs),
    });
    if (!response.ok) throw new Error(`MCP HTTP ${String(response.status)}`);
    const text = await response.text();
    const line = text.split('\n').find((entry) => entry.startsWith('data:'))?.slice(5).trim() ?? text;
    const parsed = JSON.parse(line) as { result?: unknown; error?: { message?: string } };
    if (parsed.error !== undefined) throw new Error(parsed.error.message ?? 'MCP error');
    return parsed.result;
  }

  private async stdio(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (this.child === undefined) {
      const { spawn } = await import('node:child_process');
      const env = { ...process.env, ...parseEnv(this.envJson) };
      this.child = spawn(this.server.command, this.server.args, {
        cwd: this.server.cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      // A child that writes enough diagnostics can otherwise block on a full pipe.
      this.child.stderr.resume();
    }

    const child = this.child;
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      let buffer = '';
      let settled = false;

      const cleanup = (): void => {
        clearTimeout(timer);
        child.stdout.off('data', onData);
        child.off('error', onError);
        child.off('exit', onExit);
      };
      const fail = (error: Error): void => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const accept = (result: unknown): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(result);
      };
      const inspectLine = (line: string): void => {
        if (line.trim().length === 0) return;
        try {
          const message = JSON.parse(line) as {
            id?: number;
            result?: unknown;
            error?: { message?: string };
          };
          if (message.id !== id) return;
          if (message.error !== undefined) fail(new Error(message.error.message ?? 'MCP error'));
          else accept(message.result);
        } catch {
          // Stdout may contain diagnostics; only complete JSON-RPC lines matter.
        }
      };
      const onData = (chunk: Buffer): void => {
        buffer += chunk.toString();
        for (;;) {
          const newline = buffer.indexOf('\n');
          if (newline < 0) break;
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          inspectLine(line);
          if (settled) return;
        }
      };
      const onError = (error: Error): void => fail(error);
      const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
        // Some small servers omit the final newline. Give their last complete
        // JSON value one chance before reporting that the transport disappeared.
        inspectLine(buffer);
        if (!settled) {
          fail(
            new Error(
              `MCP process exited before replying (${signal ?? `code ${String(code)}`})`,
            ),
          );
        }
      };
      const timer = setTimeout(() => fail(new Error('MCP timeout')), this.server.timeoutMs);

      child.stdout.on('data', onData);
      child.once('error', onError);
      child.once('exit', onExit);
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`,
        (error) => {
          if (error !== null && error !== undefined) fail(error);
        },
      );
    });
  }
}

function parseEnv(value: string | undefined): Record<string, string> {
  if (value === undefined) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}
