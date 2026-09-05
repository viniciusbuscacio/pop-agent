
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Profiles } from '../application/profiles.js';
import { Preferences } from '../application/preferences.js';
import { PopAgentApi } from '../infrastructure/api.js';
import { chat } from './chat.js';
import type { Context } from './commands.js';

const screen = vi.hoisted(() => ({ construct: vi.fn(), start: vi.fn(), onStreamEnd: vi.fn(), onChatLoaded: vi.fn(), onRun: vi.fn(), onArchivedChanged: vi.fn() }));
vi.mock('./tui/chat-screen.js', () => ({ ChatScreen: class {
  constructor(options: unknown) { screen.construct(options); }
  onChatLoaded = screen.onChatLoaded;
  onRun = screen.onRun;
  onArchivedChanged = screen.onArchivedChanged;
  start = screen.start;
  onStreamEnd = screen.onStreamEnd;
} }));

const originalTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
afterEach(() => {
  if (originalTTY) Object.defineProperty(process.stdout, 'isTTY', originalTTY);
  else Reflect.deleteProperty(process.stdout, 'isTTY');
  vi.restoreAllMocks(); vi.clearAllMocks();
});

function context(http: typeof fetch): Context {
  return {
    profiles: new Profiles({ read: () => ({ default: { url: 'https://pop.example', token: 'expired' } }), write: vi.fn() }),
    preferences: new Preferences({ read: () => ({}), write: vi.fn() }),
    profile: 'default',
    terminal: { line: vi.fn(), write: vi.fn(), password: vi.fn() },
    api: (options) => new PopAgentApi({ ...options, fetch: http }),
    localAccess: vi.fn(() => ({ connect: vi.fn(), close: vi.fn(), connectionId: undefined })),
    installCli: vi.fn(), waitForShutdown: vi.fn(),
  };
}

describe('interactive connection admission', () => {
  it('rejects expired login before rendering a conversation or attaching local access', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true });
    const ctx = context(async () => new Response(JSON.stringify({
      error: { code: 'invalid_session', message: 'Sign in again.' },
    }), { status: 401 }));
    expect(await chat(ctx)).toBe(1);
    expect(ctx.terminal.line).toHaveBeenCalledWith(
      'Your session expired or was revoked. Sign in again: pop login https://pop.example',
    );
    expect(screen.start).not.toHaveBeenCalled();
    expect(ctx.localAccess).not.toHaveBeenCalled();
  });

  it('does not render a connected screen when the network fails', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true });
    const ctx = context(async () => { throw new Error('Network unavailable'); });
    expect(await chat(ctx)).toBe(1);
    expect(ctx.terminal.line).toHaveBeenCalledWith('Could not connect to the server: Network unavailable');
    expect(screen.start).not.toHaveBeenCalled();
  });
});

describe('conversation continuation', () => {
  const existing = {
    id: 'existing', title: 'My saved conversation', archived: false,
    pinned: false, model: '', provider: '', createdAt: '', updatedAt: '', preview: '',
  };
  it.each([false, true])('loads the title and history, archived=%s', async (archived) => {
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true });
    const saved = { ...existing, archived };
    const history = { messages: [{
      id: 'user-1', chatId: saved.id, role: 'user', content: 'Earlier question',
      thinking: '', tools: [], attachments: [], createdAt: '',
    }] };
    const http = vi.fn<typeof fetch>(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === '/v1/events/ticket') return Response.json({ ticket: 'ticket' });
      if (path === '/v1/events') return new Response('', { headers: { 'content-type': 'text/event-stream' } });
      if (path === '/v1/chats') return Response.json({ chats: archived === String(input).includes('archived=true') ? [saved] : [] });
      if (path === '/v1/chats/existing/messages') return Response.json(history);
      throw new Error('Unexpected request');
    });
    expect(await chat(context(http), { chatId: 'existing' })).toBe(0);
    expect(screen.construct).toHaveBeenCalledWith(expect.objectContaining({ title: saved.title }));
    expect(screen.onChatLoaded).toHaveBeenCalledWith(saved, history);
    expect(screen.onChatLoaded.mock.invocationCallOrder[0]).toBeLessThan(screen.start.mock.invocationCallOrder[0]!);
    expect(screen.onArchivedChanged).toHaveBeenCalledTimes(archived ? 1 : 0);
    expect(http.mock.calls.filter(([, init]) => init?.method === 'POST').map(([url]) => String(url))).toEqual(['https://pop.example/v1/events/ticket']);
  });

  it('rejects an unknown chat and closes the admitted stream without opening a screen', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true });
    const cancel = vi.fn();
    const ctx = context(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === '/v1/events/ticket') return Response.json({ ticket: 'ticket' });
      if (path === '/v1/events') return new Response(new ReadableStream({ cancel }), { headers: { 'content-type': 'text/event-stream' } });
      return Response.json({ chats: [] });
    });
    expect(await chat(ctx, { chatId: 'missing' })).toBe(1);
    expect(cancel).toHaveBeenCalledOnce();
    expect(screen.start).not.toHaveBeenCalled();
    expect(ctx.localAccess).not.toHaveBeenCalled();
    expect(ctx.terminal.line).toHaveBeenCalledWith(expect.stringContaining('That conversation does not exist.'));
  });
});
