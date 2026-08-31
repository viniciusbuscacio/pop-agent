import { beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { createTestApp, FakeClock, type TestApp } from '../../testing/app-fixture.js';

const PASSWORD = 'correct horse battery';
const NEW_PASSWORD = 'another good password';
const DAY = 24 * 60 * 60 * 1000;

let fixture: TestApp;
let app: Hono;
let clock: FakeClock;

async function post(path: string, body?: unknown, token?: string): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token !== undefined) headers['Authorization'] = `Bearer ${token}`;
  return app.request(path, {
    method: 'POST',
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function setup(acknowledge = true): Promise<{ token: string; recoveryKey: string }> {
  const res = await post('/v1/setup', { password: PASSWORD });
  const result = (await res.json()) as { token: string; recoveryKey: string };
  if (acknowledge) {
    const acknowledged = await post('/v1/setup/acknowledge', undefined, result.token);
    expect(acknowledged.status).toBe(200);
  }
  return result;
}

beforeEach(() => {
  fixture = createTestApp();
  app = fixture.app;
  clock = fixture.clock;
});

describe('GET /v1/auth/state', () => {
  it('reports whether the wizard still has to run', async () => {
    expect(await (await app.request('/v1/auth/state')).json()).toEqual({ setupDone: false });

    await setup();

    expect(await (await app.request('/v1/auth/state')).json()).toEqual({ setupDone: true });
  });
});

describe('POST /v1/session/refresh', () => {
  it('uses the common bearer session and stays body-free', async () => {
    const { token } = await setup();
    expect((await post('/v1/session/refresh')).status).toBe(401);
    const response = await post('/v1/session/refresh', undefined, token);
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
  });
});

describe('POST /v1/setup', () => {
  it('creates a pending account and completes it only after authenticated acknowledgement', async () => {
    const body = await setup(false);
    expect(body.recoveryKey).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){5}$/);
    expect(body.token.length).toBeGreaterThan(0);
    expect(await (await app.request('/v1/auth/state')).json()).toEqual({ setupDone: false });

    expect((await post('/v1/setup/acknowledge')).status).toBe(401);
    expect((await app.request('/v1/settings', {
      headers: { Authorization: `Bearer ${body.token}` },
    })).status).toBe(401);
    const acknowledged = await post('/v1/setup/acknowledge', undefined, body.token);
    expect(acknowledged.status).toBe(200);
    expect(await acknowledged.json()).toEqual({ setupDone: true });
    expect(await (await app.request('/v1/auth/state')).json()).toEqual({ setupDone: true });
    expect((await app.request('/v1/settings', {
      headers: { Authorization: `Bearer ${body.token}` },
    })).status).toBe(200);

    const login = await post('/v1/login', { password: PASSWORD });
    const sessionToken = ((await login.json()) as { token: string }).token;
    expect((await post('/v1/setup/acknowledge', undefined, sessionToken)).status).toBe(401);
  });

  it('can resume a pending setup with the password and invalidates the lost key', async () => {
    const first = await setup(false);
    const resumed = await setup(false);

    expect(resumed.recoveryKey).not.toBe(first.recoveryKey);
    expect((await post('/v1/setup/acknowledge', undefined, first.token)).status).toBe(401);
    expect((await post('/v1/setup/acknowledge', undefined, resumed.token)).status).toBe(200);
  });

  it('refuses to run a second time', async () => {
    await setup();

    const res = await post('/v1/setup', { password: PASSWORD });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('already_setup');
  });

  it('rejects a short password', async () => {
    const res = await post('/v1/setup', { password: 'short' });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('weak_password');
  });

  it('rejects a body with an unknown field', async () => {
    const res = await post('/v1/setup', { password: PASSWORD, admin: true });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('invalid_field');
  });

  it('rejects a body missing the password', async () => {
    const res = await post('/v1/setup', {});
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('missing_field');
  });
});

describe('POST /v1/login', () => {
  beforeEach(async () => {
    await setup();
  });

  it('returns a token for the right password', async () => {
    const res = await post('/v1/login', { password: PASSWORD });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { token: string }).token.length).toBeGreaterThan(0);
  });

  it('rejects the wrong password', async () => {
    const res = await post('/v1/login', { password: 'wrong password!' });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('invalid_credentials');
  });

  it('does not bypass recovery-key acknowledgement on a pending setup', async () => {
    fixture = createTestApp();
    app = fixture.app;
    await setup(false);

    const res = await post('/v1/login', { password: PASSWORD });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('setup_incomplete');
  });
});

describe('authentication middleware', () => {
  it('rejects a protected route without a token', async () => {
    await setup();

    const res = await post('/v1/auth/sign-out-others');
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('invalid_session');
  });

  it('rejects a token that is not ours', async () => {
    await setup();

    const res = await post('/v1/auth/sign-out-others', undefined, 'made.up');
    expect(res.status).toBe(401);
  });

  it('accepts a valid token', async () => {
    const { token } = await setup();

    expect((await post('/v1/auth/sign-out-others', undefined, token)).status).toBe(200);
  });

  it('renews a token once it is over a day old', async () => {
    const { token } = await setup();

    const fresh = await post('/v1/auth/sign-out-others', undefined, token);
    expect(fresh.headers.get('x-pop-agent-token')).toBeNull();

    const { token: current } = (await fresh.json()) as { token: string };
    clock.advance(DAY + 1);

    const renewed = await post('/v1/auth/sign-out-others', undefined, current);
    expect(renewed.headers.get('x-pop-agent-token')).toBeTruthy();
  });

  it('leaves the public routes open', async () => {
    for (const path of ['/healthz', '/v1/auth/state']) {
      expect((await app.request(path)).status, path).toBe(200);
    }
  });
});

describe('POST /v1/auth/change-password', () => {
  it('issues a new token and recovery key, invalidating both old credentials', async () => {
    const { token, recoveryKey } = await setup();

    const res = await post(
      '/v1/auth/change-password',
      { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
      token,
    );
    expect(res.status).toBe(200);

    const { token: next, recoveryKey: nextRecoveryKey } = (await res.json()) as {
      token: string;
      recoveryKey: string;
    };
    expect(nextRecoveryKey).not.toBe(recoveryKey);
    expect((await post('/v1/auth/sign-out-others', undefined, token)).status).toBe(401);
    expect((await post('/v1/auth/sign-out-others', undefined, next)).status).toBe(200);

    const oldRecovery = await post('/v1/auth/recover', {
      recoveryKey,
      newPassword: PASSWORD,
    });
    expect(oldRecovery.status).toBe(401);
  });

  it('rejects a wrong current password', async () => {
    const { token } = await setup();

    const res = await post(
      '/v1/auth/change-password',
      { currentPassword: 'not it at all', newPassword: NEW_PASSWORD },
      token,
    );
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('invalid_credentials');
  });

  it('rejects a weak new password', async () => {
    const { token } = await setup();

    const res = await post(
      '/v1/auth/change-password',
      { currentPassword: PASSWORD, newPassword: 'short' },
      token,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('weak_password');
  });
});

describe('POST /v1/auth/recover', () => {
  it('sets a new password and hands back a fresh recovery key', async () => {
    const { recoveryKey, token } = await setup();

    const res = await post('/v1/auth/recover', { recoveryKey, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(200);

    const body = (await res.json()) as { token: string; recoveryKey: string };
    expect(body.recoveryKey).not.toBe(recoveryKey);
    // The session that existed before recovery is gone; the new one works.
    expect((await post('/v1/auth/sign-out-others', undefined, token)).status).toBe(401);
    expect((await post('/v1/auth/sign-out-others', undefined, body.token)).status).toBe(200);
  });

  it('accepts the key in any case, with or without hyphens', async () => {
    const { recoveryKey } = await setup();

    const res = await post('/v1/auth/recover', {
      recoveryKey: recoveryKey.toLowerCase().replace(/-/g, ''),
      newPassword: NEW_PASSWORD,
    });
    expect(res.status).toBe(200);
  });

  it('refuses to reuse a spent key', async () => {
    const { recoveryKey } = await setup();
    await post('/v1/auth/recover', { recoveryKey, newPassword: NEW_PASSWORD });

    const res = await post('/v1/auth/recover', { recoveryKey, newPassword: 'yet another password' });
    expect(res.status).toBe(401);
  });

  it('rejects a key that was never issued', async () => {
    await setup();

    const res = await post('/v1/auth/recover', {
      recoveryKey: 'ABCD-EFGH-JKMN-PQRS-TUVW-XYZ2',
      newPassword: NEW_PASSWORD,
    });
    expect(res.status).toBe(401);
  });
});

describe('POST /v1/auth/sign-out-others', () => {
  it('drops the other sessions and keeps this one', async () => {
    const { token: first } = await setup();
    const second = (await (await post('/v1/login', { password: PASSWORD })).json()) as {
      token: string;
    };

    const res = await post('/v1/auth/sign-out-others', undefined, second.token);
    expect(res.status).toBe(200);
    const { token: current } = (await res.json()) as { token: string };

    expect((await post('/v1/auth/sign-out-others', undefined, first)).status).toBe(401);
    expect((await post('/v1/auth/sign-out-others', undefined, second.token)).status).toBe(401);
    expect((await post('/v1/auth/sign-out-others', undefined, current)).status).toBe(200);
  });
});

describe('progressive lockout', () => {
  beforeEach(async () => {
    await setup();
  });

  async function failLogin(): Promise<Response> {
    return post('/v1/login', { password: 'wrong password!' });
  }

  it('lets the first four misses through, then locks for 30 seconds', async () => {
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      expect((await failLogin()).status, `attempt ${attempt}`).toBe(401);
    }

    // The fifth failure is what arms the lock.
    expect((await failLogin()).status).toBe(401);

    const locked = await failLogin();
    expect(locked.status).toBe(423);
    const body = (await locked.json()) as { error: { code: string }; retryAfterSeconds: number };
    expect(body.error.code).toBe('locked');
    expect(body.retryAfterSeconds).toBe(30);
    expect(locked.headers.get('Retry-After')).toBe('30');
  });

  it('doubles the wait on the next failure', async () => {
    for (let attempt = 1; attempt <= 5; attempt += 1) await failLogin();

    clock.advance(30_000);
    expect((await failLogin()).status).toBe(401); // sixth failure

    const locked = await failLogin();
    expect(locked.status).toBe(423);
    expect(((await locked.json()) as { retryAfterSeconds: number }).retryAfterSeconds).toBe(60);
  });

  it('counts down as time passes', async () => {
    for (let attempt = 1; attempt <= 5; attempt += 1) await failLogin();

    clock.advance(10_000);
    const locked = await failLogin();
    expect(((await locked.json()) as { retryAfterSeconds: number }).retryAfterSeconds).toBe(20);
  });

  it('forgets the failures after a successful login', async () => {
    for (let attempt = 1; attempt <= 5; attempt += 1) await failLogin();
    clock.advance(30_000);

    expect((await post('/v1/login', { password: PASSWORD })).status).toBe(200);

    // Counter cleared: a fresh miss is a plain 401 again, not a lock.
    expect((await failLogin()).status).toBe(401);
    expect((await failLogin()).status).toBe(401);
  });
});

describe('rate limit', () => {
  it('throttles a burst of credential requests', async () => {
    await setup();

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 12; attempt += 1) {
      statuses.push((await post('/v1/login', { password: PASSWORD })).status);
    }

    expect(statuses.filter((status) => status === 429).length).toBeGreaterThan(0);
  });

  it('leaves auth/state alone so a page refresh never locks the app out', async () => {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      expect((await app.request('/v1/auth/state')).status).toBe(200);
    }
  });
});
