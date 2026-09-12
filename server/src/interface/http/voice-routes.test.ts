import { beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { createTestApp, setupTestSession, type TestApp } from '../../testing/app-fixture.js';

const PASSWORD = 'correct horse battery';
let fixture: TestApp;
let app: Hono;
let token: string;

beforeEach(async () => {
  fixture = createTestApp();
  app = fixture.app;
  token = await setupTestSession(app, PASSWORD);
});

function authed(path: string, init: RequestInit = {}): Promise<Response> {
  return Promise.resolve(
    app.request(path, {
      ...init,
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
    }),
  );
}

describe('/v1/voice/models', () => {
  it('needs a session', async () => {
    expect((await app.request('/v1/voice/models')).status).toBe(401);
  });

  it('lists the models and the selected one', async () => {
    const body = (await (await authed('/v1/voice/models')).json()) as {
      models: { name: string }[];
      selected: string;
    };
    expect(body.selected).toBe('base');
    expect(body.models.some((m) => m.name === 'medium')).toBe(true);
  });

  it('selecting a model makes it the default', async () => {
    const res = await authed('/v1/voice/models/medium', { method: 'POST' });
    expect((await res.json()).selected).toBe('medium');
    const settings = (await (await authed('/v1/settings')).json()) as { voiceModel: string };
    expect(settings.voiceModel).toBe('medium');
  });

  it('rejects a bad model name', async () => {
    expect((await authed('/v1/voice/models/BAD NAME', { method: 'POST' })).status).toBe(400);
  });
});
