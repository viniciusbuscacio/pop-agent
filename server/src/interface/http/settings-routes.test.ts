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

const DEFAULT_DOC = {
  language: 'en',
  defaultProvider: 'openrouter',
  defaultModel: 'moonshotai/kimi-k3',
  customInstructions: '',
  voiceModel: 'base',
  voiceCleanup: false,
  voiceCleanupModel: '',
  autoSkillMode: 'disabled',
  distillIntervalMinutes: 10,
  autoActivatePreparedUpdates: false,
  autoRestartIdleMinutes: 10,
};

describe('GET /v1/settings', () => {
  it('needs a session', async () => {
    expect((await app.request('/v1/settings')).status).toBe(401);
  });

  it('answers with the defaults before anything was saved', async () => {
    const res = await authed('/v1/settings');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(DEFAULT_DOC);
  });
});

describe('PUT /v1/settings', () => {
  it('replaces the document and returns what was stored', async () => {
    const next = {
      ...DEFAULT_DOC,
      defaultProvider: 'openrouter',
      defaultModel: 'openai/gpt-5',
      customInstructions: 'Answer briefly.',
    };
    const res = await authed('/v1/settings', {
      method: 'PUT',
      body: JSON.stringify(next),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(next);
    expect(await (await authed('/v1/settings')).json()).toEqual(next);
  });

  it('rejects a field it does not know instead of dropping it', async () => {
    const res = await authed('/v1/settings', {
      method: 'PUT',
      body: JSON.stringify({ ...DEFAULT_DOC, telemetry: true }),
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('invalid_field');
  });

  it('accepts each auto-skill mode', async () => {
    for (const autoSkillMode of ['disabled', 'medium', 'full']) {
      const res = await authed('/v1/settings', {
        method: 'PUT',
        body: JSON.stringify({ ...DEFAULT_DOC, autoSkillMode }),
      });
      expect(res.status).toBe(200);
      expect((await res.json()).autoSkillMode).toBe(autoSkillMode);
    }
  });

  it('rejects an unsupported auto-skill mode', async () => {
    const res = await authed('/v1/settings', {
      method: 'PUT',
      body: JSON.stringify({ ...DEFAULT_DOC, autoSkillMode: 'unsafe' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects an unsupported language', async () => {
    const res = await authed('/v1/settings', {
      method: 'PUT',
      body: JSON.stringify({ ...DEFAULT_DOC, language: 'pt-BR' }),
    });

    expect(res.status).toBe(400);
  });

  it('rejects instructions past the cap instead of truncating them', async () => {
    const res = await authed('/v1/settings', {
      method: 'PUT',
      body: JSON.stringify({ ...DEFAULT_DOC, customInstructions: 'x'.repeat(4_001) }),
    });

    expect(res.status).toBe(400);
  });

  it('rejects a body that is not JSON', async () => {
    const res = await authed('/v1/settings', { method: 'PUT', body: 'not json' });

    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('missing_field');
  });

  it('needs a session', async () => {
    const res = await app.request('/v1/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ language: 'en' }),
    });

    expect(res.status).toBe(401);
  });
});

describe('GET /v1/about', () => {
  it('reports the three versions', async () => {
    const res = await authed('/v1/about');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      popAgentVersion: expect.any(String),
      nodeVersion: expect.any(String),
      piVersion: expect.any(String),
    });
  });

  it('needs a session', async () => {
    expect((await app.request('/v1/about')).status).toBe(401);
  });
});
