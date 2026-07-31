import { beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
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

describe('/v1/memory', () => {
  it('needs a session', async () => {
    expect((await app.request('/v1/memory')).status).toBe(401);
  });

  it('starts empty', async () => {
    expect(await (await authed('/v1/memory')).json()).toEqual({ doc: '', hasBackup: false });
  });

  it('writes, keeps a backup, and restores it', async () => {
    await authed('/v1/memory', { method: 'PUT', body: JSON.stringify({ doc: 'likes Elixir' }) });
    const second = await authed('/v1/memory', {
      method: 'PUT',
      body: JSON.stringify({ doc: 'likes Elixir and tea' }),
    });
    expect(await second.json()).toEqual({ doc: 'likes Elixir and tea', hasBackup: true });

    const restored = await authed('/v1/memory/restore', { method: 'POST' });
    expect((await restored.json()).doc).toBe('likes Elixir');
  });

  it('rejects a document over the cap', async () => {
    const res = await authed('/v1/memory', {
      method: 'PUT',
      body: JSON.stringify({ doc: 'x'.repeat(8001) }),
    });
    expect(res.status).toBe(400);
  });
});
