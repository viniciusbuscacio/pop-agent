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
      appLabel: 'Installed PWA',
    });
  });
});

describe('apiRequest', () => {
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
