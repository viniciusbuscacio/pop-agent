import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { entityId } from '../../domain/ids.js';
import type { McpClientFactory } from '../ports/mcp-client.js';
import type { SecretsRepo } from '../ports/secrets-repo.js';
import type { McpCapability, McpRepo, McpServer } from '../ports/mcp-repo.js';

/** MCP configuration and use cases; protocol mechanics live behind McpClientFactory. */
export class McpService {
  constructor(
    private readonly deps: {
      repo: McpRepo;
      secrets: SecretsRepo;
      clients: McpClientFactory;
      dataDir: string;
    },
  ) {}

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
    input: Omit<
      McpServer,
      | 'id'
      | 'createdAt'
      | 'updatedAt'
      | 'status'
      | 'lastError'
      | 'cwd'
      | 'protocolEra'
      | 'protocolVersion'
    > & { env?: Record<string, string> | null | undefined },
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
      env?: Record<string, string> | null | undefined;
    },
  ): McpServer | undefined {
    if (this.deps.repo.get(id) === undefined) return undefined;
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
    let connection: Awaited<ReturnType<McpClientFactory['connect']>> | undefined;
    try {
      connection = await this.deps.clients.connect(
        server,
        this.deps.secrets.get(secretKey(id)),
      );
      const now = new Date().toISOString();
      const capabilities = (await connection.capabilities()).map((capability) => ({
        ...capability,
        id: entityId('mcp-capability'),
        serverId: id,
        updatedAt: now,
      }));
      this.deps.repo.replaceCapabilities(id, capabilities);
      const updated = this.deps.repo.update(id, {
        status: 'connected',
        lastError: '',
        lastConnectedAt: now,
        protocolEra: connection.protocolEra,
        protocolVersion: connection.protocolVersion,
      })!;
      return { server: updated, capabilities };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'MCP connection failed';
      const updated = this.deps.repo.update(id, { status: 'error', lastError: message })!;
      throw Object.assign(new Error(message), { server: updated });
    } finally {
      await connection?.close();
    }
  }

  secret(id: string): string | undefined {
    return this.deps.secrets.get(secretKey(id));
  }

  async callTool(
    serverId: string,
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<string> {
    const server = this.deps.repo.get(serverId);
    if (server === undefined || !server.enabled) {
      throw new Error('MCP server is disabled or missing.');
    }
    const connection = await this.deps.clients.connect(
      server,
      this.deps.secrets.get(secretKey(serverId)),
    );
    try {
      const known = this.deps.repo
        .capabilities(serverId)
        .find((capability) => capability.kind === 'tool' && capability.name === name);
      return JSON.stringify(await connection.callTool(name, args, known, signal));
    } finally {
      await connection.close();
    }
  }

  private saveSecrets(id: string, env: Record<string, string> | null | undefined): void {
    if (env === null) this.deps.secrets.delete(secretKey(id));
    else if (env !== undefined) this.deps.secrets.set(secretKey(id), JSON.stringify(env));
  }

  static secretKey(id: string): string {
    return secretKey(id);
  }
}

function secretKey(id: string): string {
  return `mcp:${id}:env`;
}
