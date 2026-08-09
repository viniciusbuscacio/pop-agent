import { HANDS_HEADER } from '@pop-agent/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Profiles, type Profile, type ProfileStore } from '../application/profiles.js';
import { PopAgentApi } from '../infrastructure/api.js';
import { ask, chats, login, logout, servers, type Context, type Terminal } from './commands.js';

/**
 * The whole client, driven without a server (docs/cli.md, "Testable without a
 * server through a fake API"). The seam is `fetch`, handed to PopAgentApi.
 */

class MemoryStore implements ProfileStore {
  constructor(private profiles: Record<string, Profile> = {}) {}
  read(): Record<string, Profile> {
    return this.profiles;
  }
  write(profiles: Record<string, Profile>): void {
    this.profiles = profiles;
  }
}

let out: string[];
let terminal: Terminal;

beforeEach(() => {
  out = [];
  terminal = {
    line: (text = '') => out.push(text),
    write: (text) => out.push(text),
    password: () => Promise.resolve('typed-password'),
  };
});

const said = (): string => out.join('');

function contextWith(
  http: typeof globalThis.fetch,
  profiles = new Profiles(new MemoryStore()),
  handsFactory: Context['hands'] = (options) => {
    let id: string | undefined;
    return {
      connect: () => {
        id = 'hands-test';
        options.onEvent?.({ kind: 'attached' });
      },
      close: () => {
        id = undefined;
      },
      get connectionId() {
        return id;
      },
    };
  },
): Context {
  return {
    profiles,
    terminal,
    profile: 'default',
    api: (options) =>
      new PopAgentApi({ ...options, fetch: http, onToken: (token) => profiles.refresh('default', token) }),
    hands: handsFactory,
  };
}

const json = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });

describe('pop login', () => {
  it('stores the token and the server it came from', async () => {
    const profiles = new Profiles(new MemoryStore());
    const http = vi.fn(() => Promise.resolve(json({ token: 'tok-1' })));

    const code = await login(contextWith(http as never, profiles), {
      url: 'https://pop-agent.example/',
      password: 'hunter2',
    });

    expect(code).toBe(0);
    // The trailing slash is dropped, or every later path becomes `//v1/...`.
    expect(profiles.get()).toEqual({ url: 'https://pop-agent.example', token: 'tok-1' });
  });

  it('asks for the password rather than taking it on the command line', async () => {
    // A password in argv lands in the shell history and in `ps`.
    const http = vi.fn(() => Promise.resolve(json({ token: 'tok-1' })));
    await login(contextWith(http as never), { url: 'https://pop-agent.example' });

    const body = JSON.parse(String((http.mock.calls[0]?.[1] as RequestInit).body)) as {
      password: string;
    };
    expect(body.password).toBe('typed-password');
  });

  it('says what went wrong and fails, rather than storing nothing quietly', async () => {
    const profiles = new Profiles(new MemoryStore());
    const http = vi.fn(() =>
      Promise.resolve(
        json({ error: { code: 'invalid_password', message: 'That password did not work.' } }, { status: 401 }),
      ),
    );

    expect(await login(contextWith(http as never, profiles), { url: 'x', password: 'no' })).toBe(1);
    expect(said()).toContain('That password did not work.');
    expect(profiles.get()).toBeUndefined();
  });
});

describe('pop without a profile', () => {
  it('points at login instead of failing obscurely', async () => {
    const http = vi.fn(() => Promise.reject(new Error('should never be called')));
    expect(await chats(contextWith(http as never))).toBe(1);
    expect(said()).toContain('pop login');
    expect(http).not.toHaveBeenCalled();
  });
});

describe('pop servers / logout', () => {
  it('lists what is signed in', () => {
    const profiles = new Profiles(
      new MemoryStore({ default: { url: 'http://a', token: 't' }, home: { url: 'http://b', token: 't' } }),
    );
    servers(contextWith(vi.fn() as never, profiles));
    expect(said()).toContain('default');
    expect(said()).toContain('home');
  });

  it('forgets the token', () => {
    const profiles = new Profiles(new MemoryStore({ default: { url: 'http://a', token: 't' } }));
    logout(contextWith(vi.fn() as never, profiles));
    expect(profiles.get()).toBeUndefined();
  });
});

describe('token renewal', () => {
  it('stores a fresher token when the server hands one back', async () => {
    // Without this a client used weekly is signed out on a schedule (spec §9).
    const profiles = new Profiles(new MemoryStore({ default: { url: 'http://a', token: 'old' } }));
    const http = vi.fn(() =>
      Promise.resolve(
        json({ chats: [] }, { headers: { 'content-type': 'application/json', 'x-pop-agent-token': 'new' } }),
      ),
    );

    await chats(contextWith(http as never, profiles));
    expect(profiles.get()?.token).toBe('new');
  });
});

describe('pop "question"', () => {
  const events = [
    { kind: 'run-status', chatId: 'chat-1', runId: 'run-1', status: 'running' },
    { kind: 'delta', chatId: 'chat-1', runId: 'run-1', seq: 0, text: 'Forty' },
    { kind: 'delta', chatId: 'chat-1', runId: 'run-1', seq: 1, text: '-two.' },
    { kind: 'done', chatId: 'chat-1', runId: 'run-1', messageId: 'message-1' },
  ];

  function server(): typeof globalThis.fetch {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const event of events) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        controller.close();
      },
    });
    return vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/v1/events?')) return Promise.resolve(new Response(stream));
      if (url.endsWith('/v1/events/ticket')) return Promise.resolve(json({ ticket: 'tk' }));
      if (url.endsWith('/v1/chats')) return Promise.resolve(json({ id: 'chat-1' }, { status: 201 }));
      if (url.includes('/messages')) return Promise.resolve(json({ runId: 'run-1', userMessageId: 'm' }));
      return Promise.resolve(json({}));
    }) as never;
  }

  it('prints the answer as it streams and exits clean', async () => {
    const profiles = new Profiles(new MemoryStore({ default: { url: 'http://a', token: 't' } }));
    const code = await ask(contextWith(server(), profiles), 'what is the answer?');

    expect(code).toBe(0);
    expect(said()).toContain('Forty-two.');
  });

  it('attaches this machine before sending and closes it after the answer', async () => {
    const http = server();
    const profiles = new Profiles(new MemoryStore({ default: { url: 'http://a', token: 't' } }));
    let closed = false;
    const hands: Context['hands'] = (options) => {
      let id: string | undefined;
      return {
        connect: () => {
          id = 'hands-one-shot';
          options.onEvent?.({ kind: 'attached' });
        },
        close: () => {
          id = undefined;
          closed = true;
        },
        get connectionId() {
          return id;
        },
      };
    };

    await ask(contextWith(http, profiles, hands), 'hello');

    const message = (http as unknown as { mock: { calls: [RequestInfo | URL, RequestInit][] } }).mock.calls.find(
      (call) => String(call[0]).includes('/messages'),
    );
    expect((message?.[1].headers as Record<string, string>)[HANDS_HEADER]).toBe('hands-one-shot');
    expect(closed).toBe(true);
  });

  it('opens the stream before sending, or the first tokens are lost', async () => {
    // A fast run can emit `delta` before a client that sends first has
    // finished asking for its ticket.
    const http = server();
    const profiles = new Profiles(new MemoryStore({ default: { url: 'http://a', token: 't' } }));
    await ask(contextWith(http, profiles), 'hello');

    const order = (http as unknown as { mock: { calls: [RequestInfo | URL][] } }).mock.calls.map(
      (call) => String(call[0]),
    );
    expect(order.findIndex((url) => url.includes('/v1/events?'))).toBeLessThan(
      order.findIndex((url) => url.includes('/messages')),
    );
  });

  it('reports a failed run and exits non-zero', async () => {
    const failing = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/v1/events?')) {
        const encoder = new TextEncoder();
        return Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ kind: 'error', chatId: 'chat-1', runId: 'run-1', code: 'provider_down' })}\n\n`,
                  ),
                );
                controller.close();
              },
            }),
          ),
        );
      }
      if (url.endsWith('/v1/events/ticket')) return Promise.resolve(json({ ticket: 'tk' }));
      if (url.endsWith('/v1/chats')) return Promise.resolve(json({ id: 'chat-1' }, { status: 201 }));
      if (url.includes('/messages')) return Promise.resolve(json({ runId: 'run-1', userMessageId: 'm' }));
      return Promise.resolve(json({}));
    }) as never;

    const profiles = new Profiles(new MemoryStore({ default: { url: 'http://a', token: 't' } }));
    expect(await ask(contextWith(failing, profiles), 'hi')).toBe(1);
    expect(said()).toContain('provider_down');
  });
});
