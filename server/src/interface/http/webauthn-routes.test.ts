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
        host: 'pop-agent.example',
        ...(init.headers ?? {}),
      },
    }),
  );
}

describe('/v1/auth/webauthn', () => {
  it('needs a session to register', async () => {
    expect(
      (await app.request('/v1/auth/webauthn/register/options', { method: 'POST' })).status,
    ).toBe(401);
  });

  it('issues registration options with a challenge and the right rp id', async () => {
    const res = await authed('/v1/auth/webauthn/register/options', { method: 'POST' });
    const body = (await res.json()) as { challenge: string; rp: { id: string } };
    expect(body.challenge.length).toBeGreaterThan(0);
    expect(body.rp.id).toBe('pop-agent.example');
  });

  it('lists no credentials before any are registered', async () => {
    const body = (await (await authed('/v1/auth/webauthn/credentials')).json()) as {
      credentials: unknown[];
    };
    expect(body.credentials).toEqual([]);
  });

  it('says there is no passkey to log in with, publicly', async () => {
    const res = await app.request('/v1/auth/webauthn/login/options', {
      method: 'POST',
      headers: { host: 'pop-agent.example' },
    });
    expect(res.status).toBe(404);
  });
});
