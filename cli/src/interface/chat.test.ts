
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Profiles } from '../application/profiles.js';
import { Preferences } from '../application/preferences.js';
import { PopAgentApi } from '../infrastructure/api.js';
import { chat } from './chat.js';
import type { Context } from './commands.js';

const screen = vi.hoisted(() => ({ start: vi.fn(), onStreamEnd: vi.fn() }));
vi.mock('./tui/chat-screen.js', () => ({ ChatScreen: class {
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
