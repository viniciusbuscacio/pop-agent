import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { TaskDTO } from '@pop-agent/shared';
import type { Task } from '../../domain/tasks/task.js';
import { MAX_INTERVAL_MINUTES } from '../../domain/tasks/task.js';
import type { TaskService } from '../../application/tasks/task-service.js';
import { badBody, readJson, schemaError } from './body.js';
import { apiError } from './errors.js';

/**
 * Background tasks over HTTP (pop-agent.spec §21). CRUD, the enabled switch, and
 * "run now" -- which queues rather than runs inline, so the request answers
 * at once and the run itself takes as long as it takes.
 */

const MAX_TITLE = 120;
const MAX_PROMPT = 8_000;

const scheduleKind = z.enum(['once', 'interval']);
const intervalMinutes = z.number().int().min(1).max(MAX_INTERVAL_MINUTES);

const createSchema = z
  .object({
    title: z.string().min(1).max(MAX_TITLE),
    prompt: z.string().min(1).max(MAX_PROMPT),
    scheduleKind,
    intervalMinutes: intervalMinutes.optional(),
    notifyOnFinish: z.boolean().optional(),
    archiveChat: z.boolean().optional(),
  })
  .strict()
  // An interval without minutes is a schedule that cannot be honoured.
  .superRefine((value, ctx) => {
    if (value.scheduleKind === 'interval' && value.intervalMinutes === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['intervalMinutes'],
        message: 'An interval schedule needs intervalMinutes.',
      });
    }
  });

const updateSchema = z
  .object({
    title: z.string().min(1).max(MAX_TITLE).optional(),
    prompt: z.string().min(1).max(MAX_PROMPT).optional(),
    scheduleKind: scheduleKind.optional(),
    intervalMinutes: intervalMinutes.optional(),
    notifyOnFinish: z.boolean().optional(),
    archiveChat: z.boolean().optional(),
  })
  .strict();

const toggleSchema = z.object({ enabled: z.boolean() }).strict();

export interface TaskRoutesDeps {
  tasks: TaskService;
  /** The scheduler's single-file queue; "run now" is an entry into it. */
  taskScheduler: { runNow(taskId: string): 'started' | 'not_found' | 'paused' };
}

export function createTaskRoutes(deps: TaskRoutesDeps): Hono {
  const routes = new Hono();

  routes.get('/tasks', (c) => c.json({ tasks: deps.tasks.list().map(toTaskDto) }));

  routes.post('/tasks', async (c) => {
    const body = await readJson(c);
    if (body === undefined) return badBody(c);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) return schemaError(c, parsed.error);

    return c.json(toTaskDto(deps.tasks.create(parsed.data)), 201);
  });

  routes.get('/tasks/:id', (c) => {
    const task = deps.tasks.get(c.req.param('id'));
    return task === undefined ? taskNotFound(c) : c.json(toTaskDto(task));
  });

  routes.patch('/tasks/:id', async (c) => {
    const body = await readJson(c);
    if (body === undefined) return badBody(c);
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) return schemaError(c, parsed.error);

    const updated = deps.tasks.update(c.req.param('id'), parsed.data);
    return updated === undefined ? taskNotFound(c) : c.json(toTaskDto(updated));
  });

  routes.delete('/tasks/:id', (c) => {
    if (!deps.tasks.delete(c.req.param('id'))) return taskNotFound(c);
    return c.body(null, 204);
  });

  routes.post('/tasks/:id/run-now', (c) => {
    // 202: queued behind whatever the scheduler is already doing. The answer
    // shows up in the task's last status and in its own conversation.
    const result = deps.taskScheduler.runNow(c.req.param('id'));
    if (result === 'not_found') return taskNotFound(c);
    if (result === 'paused') {
      return apiError(c, 409, 'deployment_pending', 'An update is about to restart Pop Agent.');
    }
    return c.json({ started: true }, 202);
  });

  routes.post('/tasks/:id/toggle', async (c) => {
    const body = await readJson(c);
    if (body === undefined) return badBody(c);
    const parsed = toggleSchema.safeParse(body);
    if (!parsed.success) return schemaError(c, parsed.error);

    const toggled = deps.tasks.toggle(c.req.param('id'), parsed.data.enabled);
    return toggled === undefined ? taskNotFound(c) : c.json(toTaskDto(toggled));
  });

  return routes;
}

function taskNotFound(c: Context): Response {
  return apiError(c, 404, 'task_not_found', 'That task does not exist.');
}

function toTaskDto(task: Task): TaskDTO {
  return {
    id: task.id,
    title: task.title,
    prompt: task.prompt,
    scheduleKind: task.scheduleKind,
    ...(task.intervalMinutes === undefined ? {} : { intervalMinutes: task.intervalMinutes }),
    ...(task.nextRunAt === undefined ? {} : { nextRunAt: iso(task.nextRunAt) }),
    enabled: task.enabled,
    notifyOnFinish: task.notifyOnFinish,
    archiveChat: task.archiveChat,
    createdAt: iso(task.createdAt),
    ...(task.lastRunAt === undefined ? {} : { lastRunAt: iso(task.lastRunAt) }),
    ...(task.lastStatus === undefined ? {} : { lastStatus: task.lastStatus }),
    ...(task.lastChatId === undefined ? {} : { lastChatId: task.lastChatId }),
  };
}

function iso(epochMs: number): string {
  return new Date(epochMs).toISOString();
}
