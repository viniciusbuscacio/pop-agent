import { createHash } from 'node:crypto';
import {
  Client,
  SSEClientTransport,
  StreamableHTTPClientTransport,
  type FetchLike,
  type PriorDiscovery,
  type Tool,
  type Transport,
} from '@modelcontextprotocol/client';
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from '@modelcontextprotocol/client/stdio';
import type {
  DiscoveredMcpCapability,
  McpClientFactory,
  McpConnection,
} from '../../application/ports/mcp-client.js';
import type { McpServer } from '../../application/ports/mcp-repo.js';

const CLIENT_INFO = { name: 'pop-agent', version: '0.2.0' };

/** Official SDK v2 adapter, with modern-stateless negotiation and legacy fallback. */
export class OfficialMcpClientFactory implements McpClientFactory {
  private readonly verdicts = new Map<string, { prior: PriorDiscovery; expiresAt: number }>();

  async connect(server: McpServer, secretJson: string | undefined): Promise<McpConnection> {
    const key = serverKey(server, secretJson);
    const cached = this.verdicts.get(key);
    const prior = cached !== undefined && cached.expiresAt > Date.now() ? cached.prior : undefined;
    if (cached !== undefined && prior === undefined) this.verdicts.delete(key);
    const client = new Client(CLIENT_INFO, {
      versionNegotiation: {
        mode: server.transport === 'sse' ? 'legacy' : 'auto',
        probe: { timeoutMs: server.timeoutMs, maxRetries: 0 },
      },
    });
    const transport = transportFor(server, secretJson);
    try {
      await client.connect(transport, {
        timeout: server.timeoutMs,
        ...(prior === undefined ? {} : { prior }),
      });
    } catch (error) {
      this.verdicts.delete(key);
      await client.close().catch(() => undefined);
      throw error;
    }
    const discover = client.getDiscoverResult();
    this.verdicts.set(key, {
      prior: discover === undefined ? { kind: 'legacy' } : { kind: 'modern', discover },
      // Re-probe periodically so a server upgraded in place is not kept on its
      // legacy dialect for the lifetime of Pop Agent.
      expiresAt: Date.now() + 10 * 60 * 1000,
    });
    return new OfficialMcpConnection(client, transport, server.timeoutMs);
  }
}

class OfficialMcpConnection implements McpConnection {
  readonly protocolEra: 'modern' | 'legacy';
  readonly protocolVersion: string;

  constructor(
    private readonly client: Client,
    private readonly transport: Transport,
    private readonly timeoutMs: number,
  ) {
    this.protocolEra = client.getProtocolEra() ?? 'legacy';
    this.protocolVersion = client.getNegotiatedProtocolVersion() ?? 'unknown';
  }

  async capabilities(): Promise<DiscoveredMcpCapability[]> {
    const options = { timeout: this.timeoutMs };
    const advertised = this.client.getServerCapabilities();
    const [toolResult, resourceResult, templateResult, promptResult] = await Promise.all([
      advertised?.tools === undefined
        ? Promise.resolve({ tools: [] })
        : this.client.listTools(undefined, options),
      advertised?.resources === undefined
        ? Promise.resolve({ resources: [] })
        : this.client.listResources(undefined, options),
      advertised?.resources === undefined
        ? Promise.resolve({ resourceTemplates: [] })
        : this.client.listResourceTemplates(undefined, options),
      advertised?.prompts === undefined
        ? Promise.resolve({ prompts: [] })
        : this.client.listPrompts(undefined, options),
    ]);

    return [
      ...toolResult.tools.map((tool) => ({
        kind: 'tool' as const,
        name: tool.name,
        description: tool.description ?? '',
        inputSchema: asRecord(tool.inputSchema),
        metadata: compact({
          title: tool.title,
          outputSchema: tool.outputSchema,
          annotations: tool.annotations,
          icons: tool.icons,
        }),
      })),
      ...resourceResult.resources.map((resource) => ({
        kind: 'resource' as const,
        // Resource names are display labels and may repeat; URI is its stable identity.
        name: resource.uri,
        description: resource.description ?? resource.name ?? '',
        inputSchema: {},
        metadata: compact({
          uri: resource.uri,
          title: resource.title,
          mimeType: resource.mimeType,
          annotations: resource.annotations,
          icons: resource.icons,
        }),
      })),
      ...templateResult.resourceTemplates.map((template) => ({
        kind: 'resource' as const,
        name: template.uriTemplate,
        description: template.description ?? template.name ?? '',
        inputSchema: {},
        metadata: compact({
          uriTemplate: template.uriTemplate,
          title: template.title,
          mimeType: template.mimeType,
          annotations: template.annotations,
          icons: template.icons,
        }),
      })),
      ...promptResult.prompts.map((prompt) => ({
        kind: 'prompt' as const,
        name: prompt.name,
        description: prompt.description ?? '',
        inputSchema: promptSchema(prompt.arguments ?? []),
        metadata: compact({ title: prompt.title, icons: prompt.icons }),
      })),
    ];
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    definition?: DiscoveredMcpCapability,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const toolDefinition: Tool | undefined =
      definition === undefined
        ? (await this.client.listTools(undefined, { timeout: this.timeoutMs })).tools.find(
            (tool) => tool.name === name,
          )
        : {
            name: definition.name,
            description: definition.description,
            inputSchema: definition.inputSchema as Tool['inputSchema'],
          };
    return this.client.callTool(
      { name, arguments: args },
      {
        timeout: this.timeoutMs,
        maxTotalTimeout: this.timeoutMs,
        ...(signal === undefined ? {} : { signal }),
        ...(toolDefinition === undefined ? {} : { toolDefinition }),
      },
    );
  }

  async close(): Promise<void> {
    if (this.transport instanceof StreamableHTTPClientTransport) {
      await this.transport.terminateSession().catch(() => undefined);
    }
    await this.client.close();
  }
}

function serverKey(server: McpServer, secretJson: string | undefined): string {
  const authScope = createHash('sha256').update(secretJson ?? '').digest('hex');
  return JSON.stringify([
    server.id,
    server.transport,
    server.endpoint,
    server.command,
    server.args,
    server.cwd,
    server.authKind,
    server.authHeader,
    authScope,
  ]);
}

function transportFor(server: McpServer, secretJson: string | undefined): Transport {
  if (server.transport === 'stdio') {
    const transport = new StdioClientTransport({
      command: server.command,
      args: server.args,
      cwd: server.cwd,
      env: { ...getDefaultEnvironment(), ...parseEnv(secretJson) },
      stderr: 'pipe',
    });
    // Drain diagnostics from the moment the child is spawned; a full stderr
    // pipe must never deadlock a healthy protocol process.
    transport.stderr?.on('data', () => undefined);
    return transport;
  }

  const url = new URL(server.endpoint);
  const authenticatedFetch = fetchWithHeaders(authHeaders(server, secretJson), server.timeoutMs);
  if (server.transport === 'sse') {
    return new SSEClientTransport(url, { fetch: authenticatedFetch });
  }
  return new StreamableHTTPClientTransport(url, { fetch: authenticatedFetch });
}

function authHeaders(server: McpServer, secretJson: string | undefined): Headers {
  const headers = new Headers();
  if (server.authKind === 'none') return headers;
  const env = parseEnv(secretJson);
  const value = env['token'] ?? env['value'] ?? env['MCP_SECRET'] ?? Object.values(env)[0];
  if (value === undefined) return headers;
  const name =
    server.authHeader ||
    (server.authKind === 'bearer' ? 'authorization' : 'x-api-key');
  headers.set(name, server.authKind === 'bearer' ? `Bearer ${value}` : value);
  return headers;
}

function fetchWithHeaders(base: Headers, timeoutMs: number): FetchLike {
  return (input, init = {}) => {
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init.headers).forEach((value, name) => headers.set(name, value));
    base.forEach((value, name) => headers.set(name, value));
    // Session DELETE has no SDK request timer. Bound it at the fetch boundary
    // so cleanup cannot hold a successful tool result indefinitely.
    const method = init.method ?? (input instanceof Request ? input.method : 'GET');
    if (method.toUpperCase() === 'DELETE') {
      const timeout = AbortSignal.timeout(Math.min(timeoutMs, 5_000));
      const inherited = init.signal ?? (input instanceof Request ? input.signal : undefined);
      const signal = inherited == null ? timeout : AbortSignal.any([inherited, timeout]);
      return fetch(input, { ...init, headers, signal });
    }
    return fetch(input, { ...init, headers });
  };
}

function parseEnv(value: string | undefined): Record<string, string> {
  if (value === undefined) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );
  } catch {
    return {};
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function compact(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function promptSchema(
  args: { name: string; description?: string | undefined; required?: boolean | undefined }[],
): Record<string, unknown> {
  const required = args.filter((arg) => arg.required === true).map((arg) => arg.name);
  return {
    type: 'object',
    properties: Object.fromEntries(
      args.map((arg) => [
        arg.name,
        { type: 'string', ...(arg.description === undefined ? {} : { description: arg.description }) },
      ]),
    ),
    ...(required.length === 0 ? {} : { required }),
  };
}
