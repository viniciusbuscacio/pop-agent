import { Hono } from 'hono';
import { z } from 'zod';
import type { McpCapabilityDTO, McpServerDTO } from '@pop-agent/shared';
import type { McpService } from '../../application/mcp/mcp-service.js';
import type { McpCapability, McpServer } from '../../application/ports/mcp-repo.js';
import { badBody, readJson, schemaError } from './body.js';
import { apiError } from './errors.js';

const forbiddenAuthHeaders = new Set([
  'host',
  'content-length',
  'connection',
  'transfer-encoding',
  'cookie',
  'set-cookie',
  'proxy-authorization',
  'proxy-authenticate',
]);

const endpointSchema = z.string().max(2_000).refine((value) => {
  if (value === '') return true;
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol)
      && parsed.username === ''
      && parsed.password === '';
  } catch {
    return false;
  }
});
const authHeaderSchema = z.string().max(200).refine((value) => value === '' || (
  /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(value)
  && !forbiddenAuthHeaders.has(value.toLowerCase())
));
const envSchema = z.record(
  z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,99}$/),
  z.string().max(4_000),
).refine((value) => Object.keys(value).length >= 1 && Object.keys(value).length <= 50);

const baseServerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(500).default(''),
  transport: z.enum(['stdio', 'sse', 'streamable-http']),
  endpoint: endpointSchema.default(''),
  command: z.string().max(500).default(''),
  args: z.array(z.string().max(500)).max(50).default([]),
  authKind: z.enum(['none', 'bearer', 'api-key', 'custom-header']).default('none'),
  authHeader: authHeaderSchema.default(''),
  env: envSchema.nullable().optional(),
  enabled: z.boolean().default(true),
  timeoutMs: z.number().int().min(1_000).max(300_000).default(60_000),
}).strict();

const serverSchema = baseServerSchema.superRefine((value, context) => {
  if (value.transport === 'stdio' && value.command.trim() === '') {
    context.addIssue({ code: 'custom', path: ['command'], message: 'stdio requires a command.' });
  }
  if (value.transport !== 'stdio' && value.endpoint === '') {
    context.addIssue({ code: 'custom', path: ['endpoint'], message: 'HTTP transports require an endpoint.' });
  }
  if (value.authKind === 'custom-header' && value.authHeader === '') {
    context.addIssue({ code: 'custom', path: ['authHeader'], message: 'Custom-header authentication requires a header name.' });
  }
});
const updateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(500).optional(),
  transport: z.enum(['stdio', 'sse', 'streamable-http']).optional(),
  endpoint: endpointSchema.optional(),
  command: z.string().max(500).optional(),
  args: z.array(z.string().max(500)).max(50).optional(),
  authKind: z.enum(['none', 'bearer', 'api-key', 'custom-header']).optional(),
  authHeader: authHeaderSchema.optional(),
  env: envSchema.nullable().optional(),
  enabled: z.boolean().optional(),
  timeoutMs: z.number().int().min(1_000).max(300_000).optional(),
}).strict()
  .refine((patch) => Object.keys(patch).length > 0);

export function createMcpRoutes(service: McpService): Hono {
  const routes = new Hono();

  routes.get('/mcp/servers', (c) => c.json({
    servers: service.list().map((server) => toDto(server, service.secret(server.id) !== undefined)),
  }));

  routes.post('/mcp/servers', async (c) => {
    const body = await readJson(c);
    if (body === undefined) return badBody(c);
    const parsed = serverSchema.safeParse(body);
    if (!parsed.success) return schemaError(c, parsed.error);
    const created = service.create(parsed.data);
    const server = service.get(created.id);
    if (server === undefined) return apiError(c, 500, 'mcp_save_failed', 'The MCP server could not be saved.');
    return c.json({ server: toDto(server, service.secret(server.id) !== undefined) }, 201);
  });

  routes.put('/mcp/servers/:id', async (c) => {
    const current = service.get(c.req.param('id'));
    if (current === undefined) return serverNotFound(c);
    const body = await readJson(c);
    if (body === undefined) return badBody(c);
    const patch = updateSchema.safeParse(body);
    if (!patch.success) return schemaError(c, patch.error);
    const merged = serverSchema.safeParse({ ...editableFields(current), ...patch.data });
    if (!merged.success) return schemaError(c, merged.error);
    const updated = service.update(current.id, patch.data);
    if (updated === undefined) return serverNotFound(c);
    const server = service.get(updated.id);
    if (server === undefined) return serverNotFound(c);
    return c.json({ server: toDto(server, service.secret(server.id) !== undefined) });
  });

  routes.delete('/mcp/servers/:id', (c) => (
    service.delete(c.req.param('id')) ? c.body(null, 204) : serverNotFound(c)
  ));

  routes.post('/mcp/servers/:id/test', async (c) => {
    const id = c.req.param('id');
    if (service.get(id) === undefined) return serverNotFound(c);
    try {
      const result = await service.test(id);
      return c.json({
        server: toDto(
          { ...result.server, capabilities: result.capabilities },
          service.secret(id) !== undefined,
        ),
        capabilities: result.capabilities.map(capabilityDto),
      });
    } catch {
      return apiError(c, 502, 'mcp_unavailable', 'The MCP server could not be reached.');
    }
  });

  routes.post('/mcp/servers/:id/toggle', (c) => {
    const current = service.get(c.req.param('id'));
    if (current === undefined) return serverNotFound(c);
    const updated = service.update(current.id, { enabled: !current.enabled });
    if (updated === undefined) return serverNotFound(c);
    const server = service.get(updated.id);
    if (server === undefined) return serverNotFound(c);
    return c.json({ server: toDto(server, service.secret(server.id) !== undefined) });
  });

  return routes;
}

function editableFields(server: McpServer): Omit<z.input<typeof baseServerSchema>, 'env'> {
  return {
    name: server.name,
    description: server.description,
    transport: server.transport,
    endpoint: server.endpoint,
    command: server.command,
    args: server.args,
    authKind: server.authKind,
    authHeader: server.authHeader,
    enabled: server.enabled,
    timeoutMs: server.timeoutMs,
  };
}

function serverNotFound(c: Parameters<typeof apiError>[0]): Response {
  return apiError(c, 404, 'mcp_server_not_found', 'No such MCP server.');
}

function capabilityDto(capability: McpCapability): McpCapabilityDTO {
  return {
    id: capability.id,
    kind: capability.kind,
    name: capability.name,
    description: capability.description,
    ...(Object.keys(capability.inputSchema).length === 0 ? {} : { inputSchema: capability.inputSchema }),
    ...(Object.keys(capability.metadata).length === 0 ? {} : { metadata: capability.metadata }),
  };
}

function toDto(
  server: McpServer & { capabilities: McpCapability[] },
  hasCredential: boolean,
): McpServerDTO {
  return {
    id: server.id,
    name: server.name,
    description: server.description,
    transport: server.transport,
    endpoint: server.endpoint,
    command: server.command,
    args: server.args,
    authKind: server.authKind,
    authHeader: server.authHeader,
    hasCredential,
    enabled: server.enabled,
    timeoutMs: server.timeoutMs,
    status: server.status,
    lastError: server.lastError === '' ? '' : 'The MCP server could not be reached.',
    ...(server.lastConnectedAt === undefined ? {} : { lastConnectedAt: server.lastConnectedAt }),
    ...(server.protocolEra === undefined ? {} : { protocolEra: server.protocolEra }),
    ...(server.protocolVersion === undefined ? {} : { protocolVersion: server.protocolVersion }),
    capabilities: server.capabilities.map(capabilityDto),
  };
}
