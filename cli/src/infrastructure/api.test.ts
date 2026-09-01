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
  it('patches the selected chat with the archive-only request body', async () => {
    const http = vi.fn(() => Promise.resolve(new Response(JSON.stringify(archivedChat), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })));
    const api = new PopAgentApi({
      url: 'https://pop-agent.example',
      token: 'session-token',
      fetch: http as typeof globalThis.fetch,
    });

    await expect(api.patchChat('chat-archive', { archived: true })).resolves.toEqual(archivedChat);

    expect(http).toHaveBeenCalledOnce();
    const [url, init] = http.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://pop-agent.example/v1/chats/chat-archive');
    expect(init.method).toBe('PATCH');
    expect(init.body).toBe(JSON.stringify({ archived: true }));
    expect(init.headers).toMatchObject({
      authorization: 'Bearer session-token',
      'content-type': 'application/json',
    });
  });
});
