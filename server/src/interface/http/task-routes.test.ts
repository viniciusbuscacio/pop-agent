import { beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import type { TaskDTO, TasksResponse } from '@popy/shared';
import { createTestApp, type TestApp } from '../../testing/app-fixture.js';

const PASSWORD = 'correct horse battery';

let fixture: TestApp;
let app: Hono;
let token: string;

beforeEach(async () => {
  fixture = createTestApp();
  app = fixture.app;
  const res = await app.request('/v1/setup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  });
  token = ((await res.json()) as { token: string }).token;
});

function authed(path: string, init: RequestInit = {}): Promise<Response> {
  return Promise.resolve(
    app.request(path, {
      ...init,
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(init.headers ?? {}),
      },
    }),
  );
}

async function createTask(body: Record<string, unknown> = {}): Promise<TaskDTO> {
  const res = await authed('/v1/tasks', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Morning briefing',
      prompt: 'What happened overnight?',
      scheduleKind: 'once',
      ...body,
    }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as TaskDTO;
}

describe('/v1/tasks', () => {
  it('needs a session', async () => {
    expect((await app.request('/v1/tasks')).status).toBe(401);
  });

  it('starts empty', async () => {
    const body = (await (await authed('/v1/tasks')).json()) as TasksResponse;
    expect(body.tasks).toEqual([]);
  });

  it('creates a task, enabled and already scheduled', async () => {
    const task = await createTask();

    expect(task.title).toBe('Morning briefing');
    expect(task.enabled).toBe(true);
    expect(task.scheduleKind).toBe('once');
    expect(task.nextRunAt).toBeDefined();
    expect(task.lastStatus).toBeUndefined();

    const list = (await (await authed('/v1/tasks')).json()) as TasksResponse;
    expect(list.tasks.map((entry) => entry.id)).toEqual([task.id]);
  });

  it('an interval task carries its minutes and is parked one interval out', async () => {
    const task = await createTask({ scheduleKind: 'interval', intervalMinutes: 90 });

    expect(task.intervalMinutes).toBe(90);
    expect(Date.parse(task.nextRunAt ?? '')).toBe(fixture.clock.now() + 90 * 60_000);
  });

  it('refuses an interval with no minutes, and a field it does not know', async () => {
    const missing = await authed('/v1/tasks', {
      method: 'POST',
      body: JSON.stringify({ title: 'x', prompt: 'y', scheduleKind: 'interval' }),
    });
    expect(missing.status).toBe(400);

    const unknown = await authed('/v1/tasks', {
      method: 'POST',
      body: JSON.stringify({
        title: 'x',
        prompt: 'y',
        scheduleKind: 'once',
        cron: '* * * * *',
      }),
    });
    expect(unknown.status).toBe(400);
    expect(((await unknown.json()) as { error: { code: string } }).error.code).toBe('invalid_field');
  });

  it('reads one back, and 404s on one that never existed', async () => {
    const task = await createTask();
    const read = (await (await authed(`/v1/tasks/${task.id}`)).json()) as TaskDTO;
    expect(read.id).toBe(task.id);

    const missing = await authed('/v1/tasks/task-nope');
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: { code: string } }).error.code).toBe('task_not_found');
  });

  it('edits a task, and re-parks it when the schedule changes', async () => {
    const task = await createTask({ scheduleKind: 'interval', intervalMinutes: 360 });
    fixture.clock.advance(60_000);

    const res = await authed(`/v1/tasks/${task.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: 'Evening briefing', intervalMinutes: 5 }),
    });
    const updated = (await res.json()) as TaskDTO;

    expect(updated.title).toBe('Evening briefing');
    expect(updated.intervalMinutes).toBe(5);
    // The old six-hour parking must not survive a five-minute schedule.
    expect(Date.parse(updated.nextRunAt ?? '')).toBe(fixture.clock.now() + 5 * 60_000);
  });

  it('switching an interval task to once drops its minutes', async () => {
    const task = await createTask({ scheduleKind: 'interval', intervalMinutes: 15 });
    const res = await authed(`/v1/tasks/${task.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ scheduleKind: 'once' }),
    });

    const updated = (await res.json()) as TaskDTO;
    expect(updated.scheduleKind).toBe('once');
    expect(updated.intervalMinutes).toBeUndefined();
  });

  it('toggles the enabled switch and re-parks on the way back on', async () => {
    const task = await createTask({ scheduleKind: 'interval', intervalMinutes: 30 });

    const off = (await (
      await authed(`/v1/tasks/${task.id}/toggle`, {
        method: 'POST',
        body: JSON.stringify({ enabled: false }),
      })
    ).json()) as TaskDTO;
    expect(off.enabled).toBe(false);

    fixture.clock.advance(10 * 60 * 60_000);
    const on = (await (
      await authed(`/v1/tasks/${task.id}/toggle`, {
        method: 'POST',
        body: JSON.stringify({ enabled: true }),
      })
    ).json()) as TaskDTO;
    expect(on.enabled).toBe(true);
    expect(Date.parse(on.nextRunAt ?? '')).toBe(fixture.clock.now() + 30 * 60_000);
  });

  it('deletes a task, then 404s on it', async () => {
    const task = await createTask();
    expect((await authed(`/v1/tasks/${task.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await authed(`/v1/tasks/${task.id}`)).status).toBe(404);
  });

  it('run now answers 202 and the run lands in its own conversation', async () => {
    const task = await createTask({ title: 'Ping', prompt: 'say hello' });

    const res = await authed(`/v1/tasks/${task.id}/run-now`, { method: 'POST' });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ started: true });

    await fixture.taskScheduler.whenIdle();

    const after = (await (await authed(`/v1/tasks/${task.id}`)).json()) as TaskDTO;
    expect(after.lastStatus).toBe('ok');
    expect(after.lastChatId).toBeDefined();
    // A `once` task is spent by running, whichever way it was started.
    expect(after.enabled).toBe(false);

    const chat = fixture.chats.get(after.lastChatId ?? '');
    expect(chat?.title).toBe('Ping');
    const messages = fixture.chats.getMessages(chat?.id ?? '', { limit: 10 }) ?? [];
    expect(messages[0]?.content).toBe('say hello');
    expect(messages[1]?.role).toBe('assistant');
  });

  it('run now on a task that does not exist is a 404', async () => {
    const res = await authed('/v1/tasks/task-nope/run-now', { method: 'POST' });
    expect(res.status).toBe(404);
  });
});
