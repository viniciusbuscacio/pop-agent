export type McpTransport = 'stdio' | 'sse' | 'streamable-http';
export type McpAuthKind = 'none' | 'bearer' | 'api-key' | 'custom-header';
export type McpCapabilityKind = 'tool' | 'resource' | 'prompt';
export type McpServerStatus = 'unknown' | 'connected' | 'offline' | 'error';

export interface McpCapability {
  id: string;
  serverId: string;
  kind: McpCapabilityKind;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  metadata: Record<string, unknown>;
  updatedAt: string;
}

export interface McpServer {
  id: string;
  name: string;
  description: string;
  transport: McpTransport;
  endpoint: string;
  command: string;
  args: string[];
  authKind: McpAuthKind;
  authHeader: string;
  enabled: boolean;
  timeoutMs: number;
  status: McpServerStatus;
  lastError: string;
  lastConnectedAt?: string;
  /** Negotiated by the official SDK: modern is the stateless 2026 era. */
  protocolEra?: 'modern' | 'legacy';
  protocolVersion?: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
}

export type McpServerInput = Omit<McpServer, 'id' | 'status' | 'lastError' | 'lastConnectedAt' | 'createdAt' | 'updatedAt' | 'cwd'> & { cwd: string };

export interface McpRepo {
  list(): McpServer[];
  get(id: string): McpServer | undefined;
  create(server: McpServer): McpServer;
  update(id: string, server: { [K in keyof McpServer]?: McpServer[K] | undefined }): McpServer | undefined;
  delete(id: string): boolean;
  capabilities(serverId: string): McpCapability[];
  replaceCapabilities(serverId: string, capabilities: McpCapability[]): void;
}
