import type {
  A2aAgentDTO,
  A2aAgentResponse,
  A2aAgentsResponse,
  A2aInterfaceDTO,
  A2aSkillDTO,
  A2aTaskDTO,
  A2aTaskResponse,
  A2aTasksResponse,
} from '@pop-agent/shared';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type {
  A2aAgentWithDiscovery,
  A2aService,
  CreateA2aAgentInput,
  UpdateA2aAgentInput,
} from '../../application/a2a/a2a-service.js';
import type { A2aInterface, A2aSkill, A2aTask } from '../../application/ports/a2a-repo.js';
import { badBody, readJson, schemaError } from './body.js';
import { apiError } from './errors.js';

const MAX_NAME_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_URL_LENGTH = 2_000;
const MAX_HEADER_LENGTH = 200;
const MAX_CREDENTIAL_LENGTH = 4_000;
const MAX_TEXT_LENGTH = 32_000;
const MAX_ID_LENGTH = 1_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 300_000;

const idSchema = z.string().min(1).max(MAX_ID_LENGTH);
const nonBlankTextSchema = z.string().min(1).max(MAX_TEXT_LENGTH).refine((value) => value.trim() !== '');
const forbiddenAuthHeaders = new Set([
  'host', 'content-length', 'connection', 'transfer-encoding', 'cookie', 'set-cookie',
  'proxy-authorization', 'proxy-authenticate',
]);
const headerSchema = z.string().max(MAX_HEADER_LENGTH).refine(
  (value) => value === '' || (
    /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(value)
    && !forbiddenAuthHeaders.has(value.toLowerCase())
  ),
);
const baseUrlSchema = z.string().min(1).max(MAX_URL_LENGTH).refine((value) => {
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === 'https:'
      && parsed.username === ''
      && parsed.password === ''
    );
  } catch {
    return false;
  }
});

const createAgentSchema = z.object({
  name: z.string().min(1).max(MAX_NAME_LENGTH).refine((value) => value.trim() !== ''),
  description: z.string().max(MAX_DESCRIPTION_LENGTH).default(''),
  baseUrl: baseUrlSchema,
  authKind: z.enum(['none', 'bearer', 'api-key', 'custom-header']).default('none'),
  authHeader: headerSchema.default(''),
  credential: z.string().min(1).max(MAX_CREDENTIAL_LENGTH).optional(),
  enabled: z.boolean().default(true),
  timeoutMs: z.number().int().min(MIN_TIMEOUT_MS).max(MAX_TIMEOUT_MS).default(60_000),
}).strict();

const updateAgentSchema = z.object({
  name: z.string().min(1).max(MAX_NAME_LENGTH).refine((value) => value.trim() !== '').optional(),
  description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
  baseUrl: baseUrlSchema.optional(),
  authKind: z.enum(['none', 'bearer', 'api-key', 'custom-header']).optional(),
  authHeader: headerSchema.optional(),
  credential: z.string().min(1).max(MAX_CREDENTIAL_LENGTH).nullable().optional(),
  enabled: z.boolean().optional(),
  timeoutMs: z.number().int().min(MIN_TIMEOUT_MS).max(MAX_TIMEOUT_MS).optional(),
}).strict();

const messageSchema = z.object({ text: nonBlankTextSchema }).strict();
const taskQuerySchema = z.object({ agentId: idSchema.optional() }).strict();

export type A2aHttpService = Pick<
  A2aService,
  | 'list'
  | 'get'
  | 'create'
  | 'update'
  | 'delete'
  | 'test'
  | 'listTasks'
  | 'task'
  | 'sendText'
  | 'getTask'
  | 'cancelTask'
  | 'continueTask'
>;

export function createA2aRoutes(service: A2aHttpService): Hono {
  const routes = new Hono();

  routes.get('/a2a/agents', (c) => {
    const body: A2aAgentsResponse = { agents: service.list().map(agentDto) };
    return c.json(body);
  });

  routes.post('/a2a/agents', async (c) => {
    const parsed = await parseBody(c, createAgentSchema);
    if (parsed instanceof Response) return parsed;
    try {
      const input: CreateA2aAgentInput = {
        name: parsed.name,
        description: parsed.description,
        baseUrl: parsed.baseUrl,
        authKind: parsed.authKind,
        authHeader: parsed.authHeader,
        enabled: parsed.enabled,
        timeoutMs: parsed.timeoutMs,
        ...(parsed.credential === undefined ? {} : { credential: parsed.credential }),
      };
      const body: A2aAgentResponse = { agent: agentDto(service.create(input)) };
      return c.json(body, 201);
    } catch {
      return invalidConfiguration(c);
    }
  });

  routes.put('/a2a/agents/:id', async (c) => {
    const id = parseId(c);
    if (id instanceof Response) return id;
    const parsed = await parseBody(c, updateAgentSchema);
    if (parsed instanceof Response) return parsed;
    try {
      const input = Object.fromEntries(
        Object.entries(parsed).filter((entry) => entry[1] !== undefined),
      ) as UpdateA2aAgentInput;
      const agent = service.update(id, input);
      if (agent === undefined) return agentNotFound(c);
      const body: A2aAgentResponse = { agent: agentDto(agent) };
      return c.json(body);
    } catch {
      return invalidConfiguration(c);
    }
  });

  routes.delete('/a2a/agents/:id', (c) => {
    const id = parseId(c);
    if (id instanceof Response) return id;
    return service.delete(id) ? c.body(null, 204) : agentNotFound(c);
  });

  routes.post('/a2a/agents/:id/test', async (c) => {
    const id = parseId(c);
    if (id instanceof Response) return id;
    if (service.get(id) === undefined) return agentNotFound(c);
    try {
      const body: A2aAgentResponse = { agent: agentDto(await service.test(id, c.req.raw.signal)) };
      return c.json(body);
    } catch {
      return apiError(c, 502, 'a2a_unavailable', 'The A2A agent could not be reached.');
    }
  });

  routes.post('/a2a/agents/:id/toggle', (c) => {
    const id = parseId(c);
    if (id instanceof Response) return id;
    const current = service.get(id);
    if (current === undefined) return agentNotFound(c);
    const updated = service.update(id, { enabled: !current.enabled });
    if (updated === undefined) return agentNotFound(c);
    const body: A2aAgentResponse = { agent: agentDto(updated) };
    return c.json(body);
  });

  routes.get('/a2a/tasks', (c) => {
    const parsed = taskQuerySchema.safeParse(c.req.query());
    if (!parsed.success) return schemaError(c, parsed.error);
    const body: A2aTasksResponse = {
      tasks: service.listTasks(parsed.data.agentId).map(taskDto),
    };
    return c.json(body);
  });

  routes.post('/a2a/agents/:id/messages', async (c) => {
    const id = parseId(c);
    if (id instanceof Response) return id;
    if (service.get(id) === undefined) return agentNotFound(c);
    const parsed = await parseBody(c, messageSchema);
    if (parsed instanceof Response) return parsed;
    try {
      const body: A2aTaskResponse = {
        task: taskDto(await service.sendText(id, parsed.text, c.req.raw.signal)),
      };
      return c.json(body, 201);
    } catch {
      return apiError(c, 502, 'a2a_send_failed', 'The message could not be sent to the A2A agent.');
    }
  });

  routes.get('/a2a/tasks/:id', async (c) => {
    const id = parseId(c);
    if (id instanceof Response) return id;
    if (service.task(id) === undefined) return taskNotFound(c);
    try {
      const body: A2aTaskResponse = { task: taskDto(await service.getTask(id, c.req.raw.signal)) };
      return c.json(body);
    } catch {
      return taskOperationFailed(c);
    }
  });

  routes.post('/a2a/tasks/:id/cancel', async (c) => {
    const id = parseId(c);
    if (id instanceof Response) return id;
    if (service.task(id) === undefined) return taskNotFound(c);
    try {
      const body: A2aTaskResponse = {
        task: taskDto(await service.cancelTask(id, c.req.raw.signal)),
      };
      return c.json(body);
    } catch {
      return taskOperationFailed(c);
    }
  });

  routes.post('/a2a/tasks/:id/continue', async (c) => {
    const id = parseId(c);
    if (id instanceof Response) return id;
    if (service.task(id) === undefined) return taskNotFound(c);
    const parsed = await parseBody(c, messageSchema);
    if (parsed instanceof Response) return parsed;
    try {
      const body: A2aTaskResponse = {
        task: taskDto(await service.continueTask(id, parsed.text, c.req.raw.signal)),
      };
      return c.json(body);
    } catch {
      return taskOperationFailed(c);
    }
  });

  return routes;
}

async function parseBody<T extends z.ZodTypeAny>(
  c: Context,
  schema: T,
): Promise<z.infer<T> | Response> {
  const body = await readJson(c);
  if (body === undefined) return badBody(c);
  const parsed = schema.safeParse(body);
  return parsed.success ? parsed.data : schemaError(c, parsed.error);
}

function parseId(c: Context): string | Response {
  const parsed = idSchema.safeParse(c.req.param('id'));
  return parsed.success ? parsed.data : apiError(
    c,
    400,
    'invalid_field',
    'The request has a field Pop Agent cannot accept.',
  );
}

function invalidConfiguration(c: Context): Response {
  return apiError(c, 400, 'invalid_field', 'The A2A agent configuration is invalid.');
}

function agentNotFound(c: Context): Response {
  return apiError(c, 404, 'a2a_agent_not_found', 'No such A2A agent.');
}

function taskNotFound(c: Context): Response {
  return apiError(c, 404, 'a2a_task_not_found', 'No such A2A task.');
}

function taskOperationFailed(c: Context): Response {
  return apiError(c, 502, 'a2a_task_failed', 'The A2A task operation failed.');
}

function interfaceDto(value: A2aInterface): A2aInterfaceDTO {
  return {
    id: value.id,
    url: value.url,
    protocolBinding: value.protocolBinding,
    protocolVersion: value.protocolVersion,
  };
}

function skillDto(value: A2aSkill): A2aSkillDTO {
  return {
    id: value.id,
    remoteSkillId: value.remoteSkillId,
    name: value.name,
    description: value.description,
    tags: value.tags,
    examples: value.examples,
    inputModes: value.inputModes,
    outputModes: value.outputModes,
  };
}

function agentDto(value: A2aAgentWithDiscovery): A2aAgentDTO {
  return {
    id: value.id,
    name: value.name,
    description: value.description,
    baseUrl: value.baseUrl,
    authKind: value.authKind,
    authHeader: value.authHeader,
    hasCredential: value.hasCredential,
    enabled: value.enabled,
    timeoutMs: value.timeoutMs,
    status: value.status,
    lastError: value.lastError === '' ? '' : 'The A2A agent could not be reached.',
    ...(value.lastConnectedAt === undefined ? {} : { lastConnectedAt: value.lastConnectedAt }),
    protocolVersion: value.protocolVersion,
    agentVersion: value.agentVersion,
    interfaces: value.interfaces.map(interfaceDto),
    skills: value.skills.map(skillDto),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function taskDto(value: A2aTask): A2aTaskDTO {
  return {
    id: value.id,
    agentId: value.agentId,
    remoteTaskId: value.remoteTaskId,
    contextId: value.contextId,
    state: value.state,
    requestText: value.requestText,
    responseText: value.responseText,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}
