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

describe('/v1/push', () => {
  it('needs a session for the key', async () => {
    expect((await app.request('/v1/push/key')).status).toBe(401);
  });

  it('hands out the vapid public key', async () => {
    const body = (await (await authed('/v1/push/key')).json()) as { publicKey: string };
    expect(body.publicKey.length).toBeGreaterThan(0);
  });

  it('accepts a subscription', async () => {
    const res = await authed('/v1/push/subscribe', {
      method: 'POST',
      body: JSON.stringify({
        endpoint: 'https://push.example/abc',
        keys: { p256dh: 'key', auth: 'auth' },
      }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).subscribed).toBe(true);
  });

  it('rejects a malformed subscription', async () => {
    const res = await authed('/v1/push/subscribe', {
      method: 'POST',
      body: JSON.stringify({ endpoint: 'not-a-url' }),
    });
    expect(res.status).toBe(400);
  });

  it('accepts an unsubscribe', async () => {
    const res = await authed('/v1/push/unsubscribe', {
      method: 'POST',
      body: JSON.stringify({ endpoint: 'https://push.example/abc' }),
    });
    expect(res.status).toBe(200);
  });
});
