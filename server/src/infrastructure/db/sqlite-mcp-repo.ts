import type { McpCapability, McpRepo, McpServer } from '../../application/ports/mcp-repo.js';
import type { Db } from './types.js';

export class SqliteMcpRepo implements McpRepo {
  constructor(private readonly db: Db) {}

  list(): McpServer[] {
    return (this.db
      .prepare('SELECT * FROM mcp_servers ORDER BY created_at DESC, id DESC')
      .all() as McpRow[]).map(toServer);
  }

  get(id: string): McpServer | undefined {
    const row = this.db
      .prepare('SELECT * FROM mcp_servers WHERE id = ?')
      .get(id) as McpRow | undefined;
    return row === undefined ? undefined : toServer(row);
  }

  create(server: McpServer): McpServer {
    this.db.prepare(`INSERT INTO mcp_servers
      (id,name,description,transport,endpoint,command,args_json,auth_kind,auth_header,enabled,timeout_ms,status,last_error,last_connected_at,protocol_era,protocol_version,cwd,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      server.id,
      server.name,
      server.description,
      server.transport,
      server.endpoint,
      server.command,
      JSON.stringify(server.args),
      server.authKind,
      server.authHeader,
      server.enabled ? 1 : 0,
      server.timeoutMs,
      server.status,
      server.lastError,
      server.lastConnectedAt ?? null,
      server.protocolEra ?? null,
      server.protocolVersion ?? null,
      server.cwd,
      server.createdAt,
      server.updatedAt,
    );
    return server;
  }

  update(
    id: string,
    patch: { [K in keyof McpServer]?: McpServer[K] | undefined },
  ): McpServer | undefined {
    const current = this.get(id);
    if (current === undefined) return undefined;
    const next = {
      ...current,
      ...withoutUndefined(patch),
      id,
      updatedAt: new Date().toISOString(),
    } as McpServer;
    this.db.prepare(`UPDATE mcp_servers SET name=?,description=?,transport=?,endpoint=?,command=?,args_json=?,auth_kind=?,auth_header=?,enabled=?,timeout_ms=?,status=?,last_error=?,last_connected_at=?,protocol_era=?,protocol_version=?,cwd=?,updated_at=? WHERE id=?`).run(
      next.name,
      next.description,
      next.transport,
      next.endpoint,
      next.command,
      JSON.stringify(next.args),
      next.authKind,
      next.authHeader,
      next.enabled ? 1 : 0,
      next.timeoutMs,
      next.status,
      next.lastError,
      next.lastConnectedAt ?? null,
      next.protocolEra ?? null,
      next.protocolVersion ?? null,
      next.cwd,
      next.updatedAt,
      id,
    );
    return next;
  }

  delete(id: string): boolean {
    return this.db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(id).changes > 0;
  }

  capabilities(serverId: string): McpCapability[] {
    return (this.db
      .prepare('SELECT * FROM mcp_capabilities WHERE server_id=? ORDER BY kind,name')
      .all(serverId) as McpCapabilityRow[]).map(toCapability);
  }

  replaceCapabilities(serverId: string, capabilities: McpCapability[]): void {
    const transaction = this.db.transaction(() => {
      this.db.prepare('DELETE FROM mcp_capabilities WHERE server_id=?').run(serverId);
      const insert = this.db.prepare(
        'INSERT INTO mcp_capabilities (id,server_id,kind,name,description,input_schema_json,metadata_json,updated_at) VALUES (?,?,?,?,?,?,?,?)',
      );
      for (const capability of capabilities) {
        insert.run(
          capability.id,
          capability.serverId,
          capability.kind,
          capability.name,
          capability.description,
          JSON.stringify(capability.inputSchema),
          JSON.stringify(capability.metadata),
          capability.updatedAt,
        );
      }
    });
    transaction();
  }
}

interface McpRow {
  id: string;
  name: string;
  description: string;
  transport: string;
  endpoint: string;
  command: string;
  args_json: string;
  auth_kind: string;
  auth_header: string;
  enabled: number;
  timeout_ms: number;
  status: string;
  last_error: string;
  last_connected_at: string | null;
  protocol_era: string | null;
  protocol_version: string | null;
  cwd: string;
  created_at: string;
  updated_at: string;
}

interface McpCapabilityRow {
  id: string;
  server_id: string;
  kind: string;
  name: string;
  description: string;
  input_schema_json: string;
  metadata_json: string;
  updated_at: string;
}

function parse(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function withoutUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Partial<T>;
}

function toServer(row: McpRow): McpServer {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    transport: row.transport as McpServer['transport'],
    endpoint: row.endpoint,
    command: row.command,
    args: JSON.parse(row.args_json) as string[],
    authKind: row.auth_kind as McpServer['authKind'],
    authHeader: row.auth_header,
    enabled: row.enabled === 1,
    timeoutMs: row.timeout_ms,
    status: row.status as McpServer['status'],
    lastError: row.last_error,
    ...(row.last_connected_at === null ? {} : { lastConnectedAt: row.last_connected_at }),
    ...(row.protocol_era === null
      ? {}
      : { protocolEra: row.protocol_era as 'modern' | 'legacy' }),
    ...(row.protocol_version === null ? {} : { protocolVersion: row.protocol_version }),
    cwd: row.cwd,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toCapability(row: McpCapabilityRow): McpCapability {
  return {
    id: row.id,
    serverId: row.server_id,
    kind: row.kind as McpCapability['kind'],
    name: row.name,
    description: row.description,
    inputSchema: parse(row.input_schema_json),
    metadata: parse(row.metadata_json),
    updatedAt: row.updated_at,
  };
}
