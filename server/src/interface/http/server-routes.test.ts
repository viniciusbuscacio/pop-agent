import { describe, expect, it } from 'vitest';
import { createTestApp } from '../../testing/app-fixture.js';

const PASSWORD = 'correct horse battery';

async function signedIn() {
  const fixture = createTestApp();
  const res = await fixture.app.request('/v1/setup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  });
  const { token } = (await res.json()) as { token: string };
  return { ...fixture, token };
}

describe('server routes', () => {
  it('rejects /v1/server/info without a session', async () => {
    const res = await createTestApp().app.request('/v1/server/info');
    expect(res.status).toBe(401);
  });

  it('answers the server snapshot for a signed-in session', async () => {
    const { app, token } = await signedIn();
    const res = await app.request('/v1/server/info', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['cpu']).toEqual({ model: 'Test CPU', cores: 2, load: [0, 0, 0] });
    expect(body['memory']).toEqual({ total: 1024, used: 512 });
    expect(body['popyVersion']).toBe('0.0.0-test');
    expect(body['commit']).toBe('abc1234');
    expect(body['dbBytes']).toBe(100);
    expect(body['workspaceBytes']).toBe(200);
    expect(typeof body['serverTime']).toBe('string');
  });
});
