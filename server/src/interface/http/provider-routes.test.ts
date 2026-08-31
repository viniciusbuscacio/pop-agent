import { beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import type { CompletionRequest, ProviderGateway } from '../../application/ports/provider-gateway.js';
import { TranscriberError } from '../../application/ports/transcriber.js';
import {
  FakeProviderAuth,
  FakeTranscriber,
  createTestApp,
  setupTestSession,
  type TestApp,
} from '../../testing/app-fixture.js';

const PASSWORD = 'correct horse battery';

/** Accepts one key and refuses every other. */
class OneKeyGateway implements ProviderGateway {
  constructor(private readonly accepted: string) {}
  listModels(): Promise<{ id: string }[]> {
    return Promise.resolve([{ id: 'live/model' }]);
  }
  complete(request: CompletionRequest): Promise<{ text: string }> {
    if (request.apiKey !== this.accepted) {
      return Promise.reject(new Error('Invalid credentials'));
    }
    return Promise.resolve({ text: 'ok' });
  }}

let fixture: TestApp;
let app: Hono;
let token: string;

beforeEach(async () => {
  fixture = createTestApp(undefined, { gateway: new OneKeyGateway('sk-good') });
  app = fixture.app;
  token = await setupTestSession(app, PASSWORD);
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


/** The full list, with OpenRouter scripted and the rest at their defaults. */
function expectedProviders(openrouter: { configured: boolean; source: string | null }): unknown {
  return {
    providers: [
      {
        id: 'openrouter',
        name: 'OpenRouter',
        authType: 'api-key',
        configured: openrouter.configured,
        source: openrouter.source,
        defaultModel: 'moonshotai/kimi-k3',
        serviceModel: 'moonshotai/kimi-k3',
        allowCustomModel: true,
        order: 1,
        enabled: true,
      },
      {
        id: 'openai',
        name: 'OpenAI',
        authType: 'api-key',
        configured: false,
        source: null,
        defaultModel: 'gpt-4o-mini',
        serviceModel: 'gpt-4o-mini',
        allowCustomModel: true,
        order: 2,
        enabled: true,
      },
      {
        id: 'anthropic',
        name: 'Anthropic',
        authType: 'api-key',
        configured: false,
        source: null,
        defaultModel: 'claude-sonnet-4-5',
        serviceModel: 'claude-sonnet-4-5',
        allowCustomModel: true,
        order: 3,
        enabled: true,
      },
      {
        id: 'openai-codex',
        name: 'OpenAI — ChatGPT subscription',
        authType: 'oauth',
        configured: false,
        source: null,
        defaultModel: 'gpt-5.5',
        serviceModel: 'gpt-5.5',
        allowCustomModel: false,
        order: 4,
        enabled: true,
      },
      {
        id: 'github-copilot',
        name: 'GitHub Copilot subscription',
        authType: 'oauth',
        configured: false,
        source: null,
        defaultModel: 'gpt-5.4',
        serviceModel: 'gpt-5.4',
        allowCustomModel: false,
        order: 5,
        enabled: true,
      },
    ],
  };
}

describe('GET /v1/providers', () => {
  it('needs a session', async () => {
    expect((await app.request('/v1/providers')).status).toBe(401);
  });

  it('starts unconfigured', async () => {
    expect(await (await authed('/v1/providers')).json()).toEqual(
      expectedProviders({ configured: false, source: null }),
    );
  });
});

describe('GET /v1/providers/:id/subscription-usage', () => {
  it('returns only the subscription allowance for an OAuth provider', async () => {
    const local = createTestApp(undefined, {
      subscriptionUsage: {
        plan: 'plus',
        allowed: true,
        limitReached: false,
        primary: { usedPercent: 3, windowSeconds: 604_800, resetAt: 1_786_894_871 },
      },
    });
    const localToken = await setupTestSession(local.app, PASSWORD);
    const res = await local.app.request('/v1/providers/openai-codex/subscription-usage', {
      headers: { Authorization: `Bearer ${localToken}` },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      plan: 'plus',
      allowed: true,
      limitReached: false,
      primary: { usedPercent: 3, windowSeconds: 604_800, resetAt: 1_786_894_871 },
    });
  });

  it('does not offer subscription usage for an API-key provider', async () => {
    const res = await authed('/v1/providers/openrouter/subscription-usage');
    expect(res.status).toBe(404);
  });
});

describe('PUT /v1/providers/order', () => {
  it('reorders the list and reports the new positions', async () => {
    const res = await authed('/v1/providers/order', {
      method: 'PUT',
      body: JSON.stringify({ ids: ['anthropic', 'openrouter'] }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { providers: { id: string; order: number }[] };
    const positions = new Map(body.providers.map((entry) => [entry.id, entry.order]));
    expect(positions.get('anthropic')).toBe(1);
    expect(positions.get('openrouter')).toBe(2);
    // Everything left out keeps a position, after the ones that were named.
    expect(positions.get('openai')).toBe(3);
  });

  it('refuses a body that is not a list of ids', async () => {
    const res = await authed('/v1/providers/order', {
      method: 'PUT',
      body: JSON.stringify({ ids: 'anthropic' }),
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('missing_field');
  });
});

describe('PUT /v1/providers/:id/enabled', () => {
  it('rejects a non-boolean enabled field with a schema error', async () => {
    const res = await authed('/v1/providers/openrouter/enabled', {
      method: 'PUT',
      body: JSON.stringify({ enabled: 'yes' }),
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('missing_field');
  });

  it('switches a provider off and reports it', async () => {
    const res = await authed('/v1/providers/openrouter/enabled', {
      method: 'PUT',
      body: JSON.stringify({ enabled: false }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { providers: { id: string; enabled: boolean }[] };
    expect(body.providers.find((entry) => entry.id === 'openrouter')?.enabled).toBe(false);
  });

  it('404s for a provider nothing answers to', async () => {
    const res = await authed('/v1/providers/ghost/enabled', {
      method: 'PUT',
      body: JSON.stringify({ enabled: false }),
    });

    expect(res.status).toBe(404);
  });
});

describe('PUT /v1/providers/openrouter/key', () => {
  it('stores the key and reports the provider configured', async () => {
    const res = await authed('/v1/providers/openrouter/key', {
      method: 'PUT',
      body: JSON.stringify({ apiKey: 'sk-good' }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(
      expectedProviders({ configured: true, source: 'settings' }),
    );
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
    expect(await res.json()).toEqual(
      expectedProviders({ configured: false, source: null }),
    );
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
    expect(await res.json()).toEqual({ ok: true, latencyMs: 0 });
  });

  it('carries the provider s refusal back to the user', async () => {
    const res = await authed('/v1/providers/openrouter/test', {
      method: 'POST',
      body: JSON.stringify({ apiKey: 'sk-bad' }),
    });

    expect(await res.json()).toEqual({ ok: false, message: 'Invalid credentials', latencyMs: 0 });
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

    expect(await res.json()).toEqual({ ok: true, latencyMs: 0 });
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
      source: 'live',
    });
  });
});

describe('POST /v1/transcribe', () => {
  const AUDIO = `data:audio/webm;codecs=opus;base64,${Buffer.from('fake audio').toString('base64')}`;

  function withTranscriber() {
    const transcriber = new FakeTranscriber();
    return { transcriber, promise: rebuild({ transcriber }) };
  }

  async function rebuild(options: Parameters<typeof createTestApp>[1]): Promise<void> {
    fixture = createTestApp(undefined, options);
    app = fixture.app;
    token = await setupTestSession(app, PASSWORD);
  }

  it('answers the words whisper heard', async () => {
    const { transcriber, promise } = withTranscriber();
    await promise;

    const res = await authed('/v1/transcribe', {
      method: 'POST',
      body: JSON.stringify({ dataUri: AUDIO }),
    });

    expect(await res.json()).toEqual({ ok: true, text: 'what the voice note said' });
    expect(transcriber.jobs[0]?.format).toBe('webm');
    expect(transcriber.jobs[0]?.audioBase64).toBe(Buffer.from('fake audio').toString('base64'));
  });

  it('answers the failure in words, never a 500', async () => {
    const { transcriber, promise } = withTranscriber();
    await promise;
    transcriber.failure = new TranscriberError('whisper-cli is not installed');

    const res = await authed('/v1/transcribe', {
      method: 'POST',
      body: JSON.stringify({ dataUri: AUDIO }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, message: 'whisper-cli is not installed' });
  });

  it('refuses a payload that is not audio', async () => {
    const res = await authed('/v1/transcribe', {
      method: 'POST',
      body: JSON.stringify({ dataUri: 'data:text/plain;base64,aGk=' }),
    });

    expect(res.status).toBe(400);
  });

  it('rejects decoded audio over 25 MB with a specific size error', { timeout: 15_000 }, async () => {
    const overLimitBase64 = 'A'.repeat(34_952_540);
    const res = await authed('/v1/transcribe', {
      method: 'POST',
      body: JSON.stringify({ dataUri: `data:audio/webm;base64,${overLimitBase64}` }),
    });

    expect(res.status).toBe(413);
    expect((await res.json()).error.code).toBe('too_large');
  });

  it('needs a session', async () => {
    const res = await app.request('/v1/transcribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dataUri: AUDIO }),
    });

    expect(res.status).toBe(401);
  });
});

describe('PUT /v1/providers/:id/default-model', () => {
  it('stores the provider default and reports it back', async () => {
    const res = await authed('/v1/providers/anthropic/default-model', {
      method: 'PUT',
      body: JSON.stringify({ model: 'claude-haiku-4-5' }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { providers: { id: string; defaultModel: string }[] };
    expect(body.providers.find((p) => p.id === 'anthropic')?.defaultModel).toBe(
      'claude-haiku-4-5',
    );
  });

  it('404s on a provider that does not exist', async () => {
    const res = await authed('/v1/providers/nope/default-model', {
      method: 'PUT',
      body: JSON.stringify({ model: 'x' }),
    });

    expect(res.status).toBe(404);
  });
});

describe('PUT /v1/providers/:id/configuration', () => {
  it('saves credential, models, and priority in one request', async () => {
    const res = await authed('/v1/providers/anthropic/configuration', {
      method: 'PUT',
      body: JSON.stringify({
        defaultModel: 'claude-haiku-4-5',
        serviceModel: 'claude-haiku-4-5',
        priority: 1,
        apiKey: 'sk-anthropic',
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      providers: { id: string; configured: boolean; defaultModel: string; order: number }[];
    };
    expect(body.providers.find((provider) => provider.id === 'anthropic')).toMatchObject({
      configured: true,
      defaultModel: 'claude-haiku-4-5',
      order: 1,
    });
    expect(fixture.secrets.get('provider.anthropic.apiKey')).toBe('sk-anthropic');
  });

  it('validates the complete request before changing an unconfigured provider', async () => {
    const res = await authed('/v1/providers/anthropic/configuration', {
      method: 'PUT',
      body: JSON.stringify({ defaultModel: 'changed', serviceModel: '', priority: 1 }),
    });

    expect(res.status).toBe(400);
    expect(fixture.providers.status('anthropic')).toMatchObject({
      configured: false,
      defaultModel: 'claude-sonnet-4-5',
    });
  });
});

describe('subscription sign-in routes', () => {
  const CODEX = 'openai-codex';

  /** Lets the scripted login flow settle its next step. */
  function flush(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
  }

  it('refuses to start a flow for a provider that uses keys', async () => {
    const res = await authed('/v1/providers/openrouter/oauth/start', { method: 'POST' });

    expect(res.status).toBe(404);
  });

  it('has no state before a flow starts', async () => {
    const res = await authed(`/v1/providers/${CODEX}/oauth/state`, {});

    expect(res.status).toBe(404);
  });

  it('walks the whole flow: start, transcript, answer, connected', async () => {
    const started = await authed(`/v1/providers/${CODEX}/oauth/start`, { method: 'POST' });
    expect(started.status).toBe(200);
    const { flowId } = (await started.json()) as { flowId: string };
    expect(flowId.length).toBeGreaterThan(0);
    await flush();

    const state = (await (await authed(`/v1/providers/${CODEX}/oauth/state`)).json()) as {
      events: unknown[];
      pending?: { type: string };
      done: boolean;
    };
    expect(state.events).toEqual([
      { type: 'auth_url', url: 'https://example.test/oauth', instructions: 'Open and approve' },
    ]);
    expect(state.pending?.type).toBe('manual_code');
    expect(state.done).toBe(false);

    const submitted = await authed(`/v1/providers/${CODEX}/oauth/input`, {
      method: 'POST',
      body: JSON.stringify({ value: 'good-code' }),
    });
    expect(submitted.status).toBe(200);
    await flush();

    const finished = (await (await authed(`/v1/providers/${CODEX}/oauth/state`)).json()) as {
      done: boolean;
      ok?: boolean;
    };
    expect(finished).toMatchObject({ done: true, ok: true });

    const providers = (await (await authed('/v1/providers')).json()) as {
      providers: { id: string; configured: boolean; source: string | null }[];
    };
    expect(providers.providers.find((p) => p.id === CODEX)).toMatchObject({
      configured: true,
      source: 'oauth',
    });
  });

  it('carries an empty text answer through HTTP for github.com', async () => {
    const providerAuth = new FakeProviderAuth();
    let received: string | undefined;
    providerAuth.login = (_providerId, interaction) =>
      interaction
        .prompt({
          type: 'text',
          message: 'GitHub Enterprise URL/domain (blank for github.com)',
        })
        .then((answer) => {
          received = answer;
          providerAuth.authed.add('github-copilot');
        });
    const local = createTestApp(undefined, { providerAuth });
    const localToken = await setupTestSession(local.app, PASSWORD);

    await local.app.request('/v1/providers/github-copilot/oauth/start', {
      method: 'POST',
      headers: { Authorization: `Bearer ${localToken}` },
    });
    await flush();
    const submitted = await local.app.request('/v1/providers/github-copilot/oauth/input', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${localToken}`,
      },
      body: JSON.stringify({ value: '' }),
    });
    await flush();

    expect(submitted.status).toBe(200);
    expect(received).toBe('');
  });

  it('carries the flow s refusal back, and never any token words', async () => {
    await authed(`/v1/providers/${CODEX}/oauth/start`, { method: 'POST' });
    await flush();

    await authed(`/v1/providers/${CODEX}/oauth/input`, {
      method: 'POST',
      body: JSON.stringify({ value: 'wrong' }),
    });
    await flush();

    const res = await authed(`/v1/providers/${CODEX}/oauth/state`);
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ done: true, ok: false, error: 'invalid code' });
    expect(text).not.toMatch(/token|refresh|access/i);
  });

  it('has nothing to answer when no question is pending', async () => {
    const res = await authed(`/v1/providers/${CODEX}/oauth/input`, {
      method: 'POST',
      body: JSON.stringify({ value: 'anything' }),
    });

    expect(res.status).toBe(404);
  });

  it('cancel ends the flow and says so in the transcript', async () => {
    await authed(`/v1/providers/${CODEX}/oauth/start`, { method: 'POST' });
    await flush();

    const cancelled = await authed(`/v1/providers/${CODEX}/oauth/cancel`, { method: 'POST' });
    expect(cancelled.status).toBe(200);

    const state = (await (await authed(`/v1/providers/${CODEX}/oauth/state`)).json()) as {
      done: boolean;
      ok?: boolean;
    };
    expect(state).toMatchObject({ done: true, ok: false });
  });

  it('logout disconnects the subscription', async () => {
    fixture.providerAuth.authed.add(CODEX);

    const res = await authed(`/v1/providers/${CODEX}/oauth/logout`, { method: 'POST' });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      providers: { id: string; configured: boolean }[];
    };
    expect(body.providers.find((p) => p.id === CODEX)?.configured).toBe(false);
  });

  it('logout is not a thing for a key provider', async () => {
    const res = await authed('/v1/providers/openrouter/oauth/logout', { method: 'POST' });

    expect(res.status).toBe(404);
  });
});

describe('custom provider instances (docs/specs/Spec-Pop-General.md §15)', () => {
  async function createCustom(name?: string): Promise<string> {
    const res = await authed('/v1/providers/custom', {
      method: 'POST',
      body: JSON.stringify(name === undefined ? {} : { name }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    return body.id;
  }

  it('creates an instance and answers its id with the refreshed list', async () => {
    const res = await authed('/v1/providers/custom', {
      method: 'POST',
      body: JSON.stringify({ name: 'Ollama' }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      providers: { id: string; name: string; custom?: boolean }[];
    };
    expect(body.id).toMatch(/^custom-[0-9a-f]{10}$/);
    const card = body.providers.find((provider) => provider.id === body.id);
    expect(card).toMatchObject({ name: 'Ollama', custom: true });
  });

  it('creates a configured custom provider only from a complete saved form', async () => {
    const refused = await authed('/v1/providers/custom/configuration', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Incomplete',
        baseURL: 'http://localhost:11434/v1',
        defaultModel: 'llama4',
        serviceModel: '',
        priority: 1,
      }),
    });
    expect(refused.status).toBe(400);
    expect(fixture.providers.listCustom()).toEqual([]);

    const saved = await authed('/v1/providers/custom/configuration', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Ollama',
        baseURL: 'http://localhost:11434/v1',
        defaultModel: 'llama4',
        serviceModel: '',
        priority: 1,
        apiKey: 'local-key',
      }),
    });
    expect(saved.status).toBe(200);
    const body = (await saved.json()) as {
      id: string;
      providers: { id: string; configured: boolean; order: number }[];
    };
    expect(body.providers.find((provider) => provider.id === body.id)).toMatchObject({
      configured: true,
      order: 1,
    });
  });

  it('edits an instance in place, normalizing the pasted endpoint', async () => {
    const id = await createCustom('Local');

    const res = await authed(`/v1/providers/custom/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        baseURL: 'http://localhost:11434/v1/chat/completions/',
        defaultModel: 'llama4',
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      providers: { id: string; baseURL?: string; defaultModel: string }[];
    };
    expect(body.providers.find((provider) => provider.id === id)).toMatchObject({
      baseURL: 'http://localhost:11434/v1',
      defaultModel: 'llama4',
    });
  });

  it('stores and clears a key under the instance s own id', async () => {
    const id = await createCustom();

    const put = await authed(`/v1/providers/${id}/key`, {
      method: 'PUT',
      body: JSON.stringify({ apiKey: 'sk-local' }),
    });
    expect(put.status).toBe(200);
    const body = (await put.json()) as { providers: { id: string; configured: boolean }[] };
    expect(body.providers.find((provider) => provider.id === id)?.configured).toBe(true);
    expect(fixture.secrets.get(`provider.${id}.apiKey`)).toBe('sk-local');
  });

  it('deletes an instance together with its key', async () => {
    const id = await createCustom('Doomed');
    await authed(`/v1/providers/${id}/key`, {
      method: 'PUT',
      body: JSON.stringify({ apiKey: 'sk-doomed' }),
    });

    const res = await authed(`/v1/providers/custom/${id}`, { method: 'DELETE' });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { providers: { id: string }[] };
    expect(body.providers.some((provider) => provider.id === id)).toBe(false);
    expect(fixture.secrets.get(`provider.${id}.apiKey`)).toBeUndefined();
  });

  it('404s edits and deletes of an id that is not ours', async () => {
    const patch = await authed('/v1/providers/custom/custom-0000000000', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'nope' }),
    });
    const remove = await authed('/v1/providers/custom/custom-0000000000', { method: 'DELETE' });

    expect(patch.status).toBe(404);
    expect(remove.status).toBe(404);
  });

  it('rejects an endpoint that is not a URL', async () => {
    const id = await createCustom();

    const res = await authed(`/v1/providers/custom/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ baseURL: 'not a url' }),
    });

    expect(res.status).toBe(400);
  });
});
