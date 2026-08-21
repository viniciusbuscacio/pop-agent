// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiRequest, clientEnvironment } from './api';

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('clientEnvironment', () => {
  it('describes an installed iPhone PWA as this device, not as the server', () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
      standalone: true,
    });

    expect(clientEnvironment()).toEqual({
      kind: 'pwa',
      platform: 'ios',
      deviceLabel: 'This iPhone',
      appLabel: 'Installed app',
    });
  });
});

describe('apiRequest', () => {
  function useInstalledPwa(): void {
    vi.stubGlobal('navigator', { userAgent: 'Windows', standalone: true });
  }

  function apiFailure(code: string, message = 'failed'): Response {
    return new Response(JSON.stringify({ error: { code, message } }), { status: 409 });
  }

  it('parses the JSON body of an ok response', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(new Response(JSON.stringify({ id: 'chat-1' }), { status: 200 })),
    );

    await expect(apiRequest('/chats/chat-1')).resolves.toEqual({ id: 'chat-1' });
  });

  it('resolves a bodyless 204 instead of choking on the missing JSON', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(null, { status: 204 })));

    await expect(apiRequest<void>('/chats/chat-1', { method: 'DELETE' })).resolves.toBeUndefined();
  });

  it('sends only the stable machine the user selected explicitly', async () => {
    localStorage.setItem('pop-agent.local-machine-selection-v2', 'machine-mac');
    const fetch = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(new Response('{}', { status: 200 })),
    );
    vi.stubGlobal('fetch', fetch);

    await apiRequest('/chats/chat-1/messages', { method: 'POST', body: { text: 'hello' } });

    expect((fetch.mock.calls[0]?.[1] as RequestInit).headers).toMatchObject({
      'x-pop-agent-local-connection': 'machine-mac',
      'x-pop-agent-event-version': '2',
    });
  });

  it('does not send an automatic or temporary selection persisted by an older PWA', async () => {
    localStorage.setItem('pop-agent.local-connection', 'machine-legacy');
    const fetch = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(new Response('{}', { status: 200 })),
    );
    vi.stubGlobal('fetch', fetch);

    await apiRequest('/chats/chat-1/messages', { method: 'POST', body: { text: 'hello' } });

    expect((fetch.mock.calls[0]?.[1] as RequestInit).headers).not.toHaveProperty(
      'x-pop-agent-local-connection',
    );
    expect(localStorage.getItem('pop-agent.local-connection')).toBeNull();
    expect(localStorage.getItem('pop-agent.local-machine-selection-v2')).toBeNull();
  });

  it.each([
    ['POST', '/chats/chat-1/messages'],
    ['PUT', '/chats/chat-1/queue/queued-1'],
  ])('retries only transient local-machine failures for PWA %s %s', async (method, path) => {
    useInstalledPwa();
    localStorage.setItem('pop-agent.local-machine-selection-v2', 'machine-windows');
    const fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(apiFailure('local_connection_unavailable')))
      // The stable machine has reattached under a new server connection ID;
      // the browser still names only the stable selector on its retry.
      .mockImplementationOnce(() => Promise.resolve(new Response('{}', { status: 202 })));
    vi.stubGlobal('fetch', fetch);
    const sleeps: number[] = [];

    await apiRequest(path, { method, body: { text: 'hello' } }, {
      reconnectDelaysMs: [500],
      sleep: (milliseconds) => { sleeps.push(milliseconds); return Promise.resolve(); },
    });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([500]);
    for (const call of fetch.mock.calls) {
      expect((call[1] as RequestInit).headers).toMatchObject({
        'x-pop-agent-local-connection': 'machine-windows',
      });
    }
    expect(localStorage.getItem('pop-agent.local-machine-selection-v2')).toBe('machine-windows');
  });

  it('bounds the PWA reconnect grace window with injected delays', async () => {
    useInstalledPwa();
    localStorage.setItem('pop-agent.local-machine-selection-v2', 'machine-windows');
    const fetch = vi.fn(() => Promise.resolve(apiFailure('local_connection_unavailable')));
    vi.stubGlobal('fetch', fetch);
    const sleeps: number[] = [];

    await expect(apiRequest('/chats/chat-1/messages', { method: 'POST', body: { text: 'hello' } }, {
      reconnectDelaysMs: [2_000, 3_000, 5_000],
      sleep: (milliseconds) => { sleeps.push(milliseconds); return Promise.resolve(); },
    })).rejects.toMatchObject({ code: 'local_connection_unavailable' });

    expect(sleeps).toEqual([2_000, 3_000, 5_000]);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(localStorage.getItem('pop-agent.local-machine-selection-v2')).toBe('machine-windows');
  });

  it('clears an unknown persisted machine without retrying the rejected request', async () => {
    useInstalledPwa();
    localStorage.setItem('pop-agent.local-machine-selection-v2', 'machine-removed');
    const fetch = vi.fn(() => Promise.resolve(apiFailure('local_connection_unknown')));
    vi.stubGlobal('fetch', fetch);

    await expect(apiRequest('/chats/chat-1/messages', { method: 'POST', body: { text: 'hello' } }, {
      reconnectDelaysMs: [1],
      sleep: () => Promise.resolve(),
    })).rejects.toMatchObject({ code: 'local_connection_unknown' });

    expect(fetch).toHaveBeenCalledOnce();
    expect(localStorage.getItem('pop-agent.local-machine-selection-v2')).toBeNull();
  });

  it('does not retry local-machine failures for web, non-chat, or arbitrary errors', async () => {
    localStorage.setItem('pop-agent.local-machine-selection-v2', 'machine-mac');
    const fetch = vi.fn(() => Promise.resolve(apiFailure('local_connection_unavailable')));
    vi.stubGlobal('fetch', fetch);
    await expect(apiRequest('/chats/chat-1/messages', { method: 'POST', body: { text: 'web' } }))
      .rejects.toMatchObject({ code: 'local_connection_unavailable' });

    useInstalledPwa();
    await expect(apiRequest('/settings', { method: 'PUT', body: {} }))
      .rejects.toMatchObject({ code: 'local_connection_unavailable' });
    vi.stubGlobal('fetch', () => Promise.resolve(apiFailure('queue_full')));
    await expect(apiRequest('/chats/chat-1/messages', { method: 'POST', body: { text: 'full' } }, {
      reconnectDelaysMs: [1], sleep: () => Promise.resolve(),
    })).rejects.toMatchObject({ code: 'queue_full' });

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('turns an error envelope into a typed ApiError', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        new Response(JSON.stringify({ error: { code: 'not_found', message: 'No such chat.' } }), {
          status: 404,
        }),
      ),
    );

    await expect(apiRequest('/chats/nope')).rejects.toMatchObject(
      new ApiError('not_found', 'No such chat.', 404),
    );
  });
});
