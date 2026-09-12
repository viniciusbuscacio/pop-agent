import type { McpCapabilityKind, McpServer } from './mcp-repo.js';

/** Capability shape discovered through the SDK, before persistence assigns ids. */
export interface DiscoveredMcpCapability {
  kind: McpCapabilityKind;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export interface McpConnection {
  readonly protocolEra: 'modern' | 'legacy';
  readonly protocolVersion: string;
  capabilities(): Promise<DiscoveredMcpCapability[]>;
  callTool(
    name: string,
    args: Record<string, unknown>,
    definition?: DiscoveredMcpCapability,
    signal?: AbortSignal,
  ): Promise<unknown>;
  close(): Promise<void>;
}

/** Infrastructure boundary around the official MCP SDK. */
export interface McpClientFactory {
  connect(server: McpServer, secretJson: string | undefined): Promise<McpConnection>;
}
