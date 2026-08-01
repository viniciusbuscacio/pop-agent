import { describe, expect, it } from 'vitest';
import { createTestApp, FakeClock } from '../../testing/app-fixture.js';

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

describe('server danger zone', () => {
  it('rejects the actions without a session', async () => {
    const { app } = createTestApp();
    for (const path of ['/v1/server/restart', '/v1/server/stop', '/v1/server/llm-stop', '/v1/server/llm-start']) {
      const res = await app.request(path, { method: 'POST' });
      expect(res.status, path).toBe(401);
    }
  });

  it('restart and stop delegate to the service control', async () => {
    const { app, token, controlLog } = await signedIn();
    for (const action of ['restart', 'stop']) {
      const res = await app.request(`/v1/server/${action}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true, action });
    }
    expect(controlLog).toEqual(['restart', 'stop']);
  });

  it('llm-stop refuses new runs with a persisted error until llm-start', async () => {
    const { app, token } = await signedIn();
    const created = await app.request('/v1/chats', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    const chat = (await created.json()) as { id: string };

    const stop = await app.request('/v1/server/llm-stop', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(stop.status).toBe(200);
    expect(await stop.json()).toMatchObject({ ok: true, interrupted: 0 });

    // A new run is refused at the door...
    const res = await app.request(`/v1/chats/${chat.id}/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'hello?' }),
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: { code: 'llm_stopped' } });

    // ...and both the question and the reason are history now.
    const list = await app.request(`/v1/chats/${chat.id}/messages`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const { messages } = (await list.json()) as { messages: { role: string; content: string }[] };
    expect(messages.map((m) => m.role)).toEqual(['user', 'system']);
    expect(messages[1]?.content).toContain('LLM stopped by operator');

    // Restarting the brain lets runs through again.
    const start = await app.request('/v1/server/llm-start', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(start.status).toBe(200);

    const retry = await app.request(`/v1/chats/${chat.id}/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'hello again' }),
    });
    expect(retry.status).toBe(202);
  });
});

describe('provider credits route', () => {
  it('404s when no balance is available and answers the scripted one', async () => {
    const { app, token } = await signedIn();
    const missing = await app.request('/v1/providers/openrouter/credits', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(missing.status).toBe(404);
  });

  it('answers the balance when the provider publishes one', async () => {
    const fixture = createTestApp(new FakeClock(), { credits: { remaining: 8.5, used: 1.5 } });
    const res = await fixture.app.request('/v1/setup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD }),
    });
    const { token } = (await res.json()) as { token: string };
    const found = await fixture.app.request('/v1/providers/openrouter/credits', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(found.status).toBe(200);
    expect(await found.json()).toEqual({ remaining: 8.5, used: 1.5 });
  });
});
