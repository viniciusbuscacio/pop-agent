export type McpTransport = 'stdio' | 'sse' | 'streamable-http';
export type McpAuthKind = 'none' | 'bearer' | 'api-key' | 'custom-header';
export type McpCapabilityKind = 'tool' | 'resource' | 'prompt';
export type McpServerStatus = 'unknown' | 'connected' | 'offline' | 'error';

export interface McpCapabilityDTO {
  id: string;
  kind: McpCapabilityKind;
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface McpServerDTO {
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
  cwd: string;
  capabilities: McpCapabilityDTO[];
}

export interface McpServersResponse { servers: McpServerDTO[]; }
export interface McpServerResponse { server: McpServerDTO; }
export interface McpTestResponse { server: McpServerDTO; capabilities: McpCapabilityDTO[]; }
