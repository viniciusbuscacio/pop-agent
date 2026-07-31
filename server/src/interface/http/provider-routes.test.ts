import { beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import type { CompletionRequest, ProviderGateway } from '../../application/ports/provider-gateway.js';
import { createTestApp, type TestApp } from '../../testing/app-fixture.js';

const PASSWORD = 'correct horse battery';

/** Accepts one key and refuses every other. */
class OneKeyGateway implements ProviderGateway {
  constructor(private readonly accepted: string) {}
  listModels(): Promise<{ id: string }[]> {
    return Promise.resolve([{ id: 'live/model' }]);
  }
  complete(request: CompletionRequest): Promise<string> {
    if (request.apiKey !== this.accepted) {
      return Promise.reject(new Error('Invalid credentials'));
    }
    return Promise.resolve('ok');
  }
}

let fixture: TestApp;
let app: Hono;
let token: string;

beforeEach(async () => {
  fixture = createTestApp(undefined, { gateway: new OneKeyGateway('sk-good') });
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

describe('GET /v1/providers', () => {
  it('needs a session', async () => {
    expect((await app.request('/v1/providers')).status).toBe(401);
  });

  it('starts unconfigured', async () => {
    expect(await (await authed('/v1/providers')).json()).toEqual({
      providers: [{ id: 'openrouter', configured: false, source: null }],
    });
  });
});

describe('PUT /v1/providers/openrouter/key', () => {
  it('stores the key and reports the provider configured', async () => {
    const res = await authed('/v1/providers/openrouter/key', {
      method: 'PUT',
      body: JSON.stringify({ apiKey: 'sk-good' }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      providers: [{ id: 'openrouter', configured: true, source: 'settings' }],
    });
  });

  it('never hands the key back, on any route', async () => {
    await authed('/v1/providers/openrouter/key', {
      method: 'PUT',
      body: JSON.stringify({ apiKey: 'sk-good' }),
    });

    const providers = await (await authed('/v1/providers')).text();
    const settings = await (await authed('/v1/settings')).text();
    expect(providers).not.toContain('sk-good');
    expect(settings).not.toContain('sk-good');
  });

  it('rejects an empty key', async () => {
    const res = await authed('/v1/providers/openrouter/key', {
      method: 'PUT',
      body: JSON.stringify({ apiKey: '' }),
    });

    expect(res.status).toBe(400);
  });
});

describe('DELETE /v1/providers/openrouter/key', () => {
  it('removes the stored key', async () => {
    await authed('/v1/providers/openrouter/key', {
      method: 'PUT',
      body: JSON.stringify({ apiKey: 'sk-good' }),
    });

    const res = await authed('/v1/providers/openrouter/key', { method: 'DELETE' });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      providers: [{ id: 'openrouter', configured: false, source: null }],
    });
  });

  it('has nothing to remove when no key was stored', async () => {
    const res = await authed('/v1/providers/openrouter/key', { method: 'DELETE' });

    expect(res.status).toBe(404);
  });
});

describe('POST /v1/providers/openrouter/test', () => {
  it('says ok for a key the provider accepts', async () => {
    const res = await authed('/v1/providers/openrouter/test', {
      method: 'POST',
      body: JSON.stringify({ apiKey: 'sk-good' }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('carries the provider s refusal back to the user', async () => {
    const res = await authed('/v1/providers/openrouter/test', {
      method: 'POST',
      body: JSON.stringify({ apiKey: 'sk-bad' }),
    });

    expect(await res.json()).toEqual({ ok: false, message: 'Invalid credentials' });
  });

  it('tests the stored key when the body names none', async () => {
    await authed('/v1/providers/openrouter/key', {
      method: 'PUT',
      body: JSON.stringify({ apiKey: 'sk-good' }),
    });

    const res = await authed('/v1/providers/openrouter/test', {
      method: 'POST',
      body: JSON.stringify({}),
    });

    expect(await res.json()).toEqual({ ok: true });
  });

  it('fails politely when there is no key anywhere', async () => {
    const res = await authed('/v1/providers/openrouter/test', {
      method: 'POST',
      body: JSON.stringify({}),
    });

    const body = (await res.json()) as { ok: boolean };
    expect(res.status).toBe(200);
    expect(body.ok).toBe(false);
  });
});

describe('GET /v1/models with a configured key', () => {
  it('answers the live catalog instead of the engine catalog', async () => {
    await authed('/v1/providers/openrouter/key', {
      method: 'PUT',
      body: JSON.stringify({ apiKey: 'sk-good' }),
    });

    expect(await (await authed('/v1/models')).json()).toEqual({
      models: [{ id: 'live/model' }],
    });
  });
});
