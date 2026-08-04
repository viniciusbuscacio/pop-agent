import type { McpCapability, McpRepo, McpServer } from '../../application/ports/mcp-repo.js';
import type { Db } from './types.js';

export class SqliteMcpRepo implements McpRepo {
  constructor(private readonly db: Db) {}

  list(): McpServer[] {
    return (this.db.prepare('SELECT * FROM mcp_servers ORDER BY created_at DESC, id DESC').all() as McpRow[]).map(toServer);
  }
  get(id: string): McpServer | undefined {
    const row = this.db.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(id) as McpRow | undefined;
    return row === undefined ? undefined : toServer(row);
  }
  create(server: McpServer): McpServer {
    this.db.prepare(`INSERT INTO mcp_servers
      (id,name,description,transport,endpoint,command,args_json,auth_kind,auth_header,enabled,timeout_ms,status,last_error,last_connected_at,cwd,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      server.id, server.name, server.description, server.transport, server.endpoint, server.command,
      JSON.stringify(server.args), server.authKind, server.authHeader, server.enabled ? 1 : 0,
      server.timeoutMs, server.status, server.lastError, server.lastConnectedAt ?? null, server.cwd,
      server.createdAt, server.updatedAt,
    );
    return server;
  }
  update(id: string, patch: { [K in keyof McpServer]?: McpServer[K] | undefined }): McpServer | undefined {
    const current = this.get(id);
    if (current === undefined) return undefined;
    const next = { ...current, ...withoutUndefined(patch), id, updatedAt: new Date().toISOString() } as McpServer;
    this.db.prepare(`UPDATE mcp_servers SET name=?,description=?,transport=?,endpoint=?,command=?,args_json=?,auth_kind=?,auth_header=?,enabled=?,timeout_ms=?,status=?,last_error=?,last_connected_at=?,cwd=?,updated_at=? WHERE id=?`).run(
      next.name, next.description, next.transport, next.endpoint, next.command, JSON.stringify(next.args),
      next.authKind, next.authHeader, next.enabled ? 1 : 0, next.timeoutMs, next.status, next.lastError,
      next.lastConnectedAt ?? null, next.cwd, next.updatedAt, id,
    );
    return next;
  }
  delete(id: string): boolean { return this.db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(id).changes > 0; }
  capabilities(serverId: string): McpCapability[] {
    return (this.db.prepare('SELECT * FROM mcp_capabilities WHERE server_id=? ORDER BY kind,name').all(serverId) as McpCapabilityRow[]).map(toCapability);
  }
  replaceCapabilities(serverId: string, capabilities: McpCapability[]): void {
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM mcp_capabilities WHERE server_id=?').run(serverId);
      const insert = this.db.prepare(`INSERT INTO mcp_capabilities (id,server_id,kind,name,description,input_schema_json,metadata_json,updated_at) VALUES (?,?,?,?,?,?,?,?)`);
      for (const c of capabilities) insert.run(c.id, c.serverId, c.kind, c.name, c.description, JSON.stringify(c.inputSchema), JSON.stringify(c.metadata), c.updatedAt);
    });
    tx();
  }
}

interface McpRow { id:string; name:string; description:string; transport:string; endpoint:string; command:string; args_json:string; auth_kind:string; auth_header:string; enabled:number; timeout_ms:number; status:string; last_error:string; last_connected_at:string|null; cwd:string; created_at:string; updated_at:string; }
interface McpCapabilityRow { id:string; server_id:string; kind:string; name:string; description:string; input_schema_json:string; metadata_json:string; updated_at:string; }
const parse = (value:string): Record<string, unknown> => { try { const parsed=JSON.parse(value) as unknown; return parsed && typeof parsed==='object' && !Array.isArray(parsed) ? parsed as Record<string,unknown> : {}; } catch { return {}; } };
function withoutUndefined<T extends object>(value: T): Partial<T> { return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>; }
function toServer(r:McpRow):McpServer { return { id:r.id,name:r.name,description:r.description,transport:r.transport as McpServer['transport'],endpoint:r.endpoint,command:r.command,args:JSON.parse(r.args_json) as string[],authKind:r.auth_kind as McpServer['authKind'],authHeader:r.auth_header,enabled:r.enabled===1,timeoutMs:r.timeout_ms,status:r.status as McpServer['status'],lastError:r.last_error,...(r.last_connected_at===null?{}:{lastConnectedAt:r.last_connected_at}),cwd:r.cwd,createdAt:r.created_at,updatedAt:r.updated_at }; }
function toCapability(r:McpCapabilityRow):McpCapability { return { id:r.id,serverId:r.server_id,kind:r.kind as McpCapability['kind'],name:r.name,description:r.description,inputSchema:parse(r.input_schema_json),metadata:parse(r.metadata_json),updatedAt:r.updated_at }; }
