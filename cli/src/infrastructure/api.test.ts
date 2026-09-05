import { describe, expect, it, vi } from 'vitest';
import { PopAgentApi } from './api.js';

const archivedChat = {
  id: 'chat-archive',
  title: 'Archive me',
  model: '',
  provider: '',
  archived: true,
  pinned: false,
  createdAt: '',
  updatedAt: '',
  preview: '',
};

describe('PopAgentApi', () => {
  it('requests a provider catalog with an encoded provider id', async () => {
    const http = vi.fn(() => Promise.resolve(Response.json({ models: [], source: 'static' })));
    const api = new PopAgentApi({
      url: 'https://pop-agent.example',
      token: 'session-token',
      fetch: http as typeof globalThis.fetch,
    });

    await api.models('custom/provider name');

    expect(http.mock.calls[0]?.[0]).toBe(
      'https://pop-agent.example/v1/models?provider=custom%2Fprovider%20name',
    );
  });

  it('patches a model only as an authoritative provider/model pair', async () => {
    const selected = { ...archivedChat, provider: 'openrouter', model: 'vendor/model' };
    const http = vi.fn(() => Promise.resolve(Response.json(selected)));
    const api = new PopAgentApi({
      url: 'https://pop-agent.example',
      token: 'session-token',
      fetch: http as typeof globalThis.fetch,
    });

    await api.patchChat('chat-archive', { provider: 'openrouter', model: 'vendor/model' });

    expect((http.mock.calls[0]?.[1] as RequestInit | undefined)?.body).toBe(
      JSON.stringify({ provider: 'openrouter', model: 'vendor/model' }),
    );
  });

  it.each([
    { archived: true, label: 'archive' },
    { archived: false, label: 'unarchive' },
  ])('patches the selected chat with the $label-only request body', async ({ archived }) => {
    const http = vi.fn(() => Promise.resolve(new Response(JSON.stringify(archivedChat), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })));
    const api = new PopAgentApi({
      url: 'https://pop-agent.example',
      token: 'session-token',
      fetch: http as typeof globalThis.fetch,
    });

    await expect(api.patchChat('chat-archive', { archived })).resolves.toEqual(archivedChat);

    expect(http).toHaveBeenCalledOnce();
    const [url, init] = http.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://pop-agent.example/v1/chats/chat-archive');
    expect(init.method).toBe('PATCH');
    expect(init.body).toBe(JSON.stringify({ archived }));
    expect(init.headers).toMatchObject({
      authorization: 'Bearer session-token',
      'content-type': 'application/json',
    });
  });
});

describe('session and stream failures', () => {
  it('uses each renewed token on the next request', async () => {
    const headers: unknown[] = [];
    const api = new PopAgentApi({
      url: 'https://pop.example', token: 'old',
      fetch: async (_url, init) => {
        headers.push(init?.headers);
        return new Response(null, { status: 204, headers: { 'x-pop-agent-token': 'renewed' } });
      },
    });
    await api.request('/session/refresh', { method: 'POST' });
    await api.request('/session/refresh', { method: 'POST' });
    expect(headers).toMatchObject([{ authorization: 'Bearer old' }, { authorization: 'Bearer renewed' }]);
  });

  it('reads credentials changed by another login without recreating the API', async () => {
    let token = 'first';
    const http = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    const api = new PopAgentApi({ url: 'https://pop.example', token: () => token, fetch: http });
    await api.request('/session/refresh');
    token = 'second';
    await api.request('/session/refresh');
    expect(http.mock.calls[1]?.[1]?.headers).toMatchObject({ authorization: 'Bearer second' });
  });

  it('preserves a rejected event ticket as an authentication error', async () => {
    const api = new PopAgentApi({
      url: 'https://pop.example',
      fetch: async () => new Response(JSON.stringify({ error: { code: 'invalid_session', message: 'Sign in again.' } }), { status: 401 }),
    });
    await expect(api.openEvents('spent')).rejects.toMatchObject({ code: 'invalid_session', status: 401 });
  });

  it('rejects a proxy HTML response instead of reading it as a healthy stream', async () => {
    const api = new PopAgentApi({
      url: 'https://pop.example',
      fetch: async () => new Response('<html>Proxy</html>', { headers: { 'content-type': 'text/html' } }),
    });
    await expect(api.openEvents('ticket')).rejects.toMatchObject({ code: 'invalid_stream' });
  });
});
