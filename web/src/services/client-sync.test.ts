// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StreamEvent } from '@pop-agent/shared';
import { ensureChat, refreshClientData, startClientSync } from './client-sync';
import { syncQueue } from './sync-queue';

const test = vi.hoisted(() => ({
  calls: [] as string[],
  manifest: { epoch: 'one', revisions: {} as Record<string, number> },
  events: undefined as ((event: StreamEvent) => void) | undefined,
  opened: undefined as (() => void) | undefined,
  messages: {} as Record<string, unknown[]>,
  openChat: vi.fn(async (_id: string, _background?: boolean, _signal?: AbortSignal) => undefined),
  token: 'session' as string | undefined,
}));
vi.mock('./session', () => ({ session: { token: () => test.token, generation: () => 0 } }));
vi.mock('./api', () => ({ apiRequest: vi.fn(async () => structuredClone(test.manifest)) }));
vi.mock('./events', () => ({ eventStream: {
  subscribe: (listener: (event: StreamEvent) => void) => { test.events = listener; return () => { test.events = undefined; }; },
  onOpen: (listener: () => void) => { test.opened = listener; return () => { test.opened = undefined; }; },
} }));
vi.mock('./chat-cache', () => ({ chatCache: { get: vi.fn(async () => undefined), getLists: vi.fn(async () => undefined), put: vi.fn(), putLists: vi.fn() } }));
vi.mock('./settings-cache', () => ({ settingsCache: { read: vi.fn(async () => undefined), write: vi.fn(), clear: vi.fn() } }));
vi.mock('./providers', () => ({ providersService: { subscriptionUsage: vi.fn() } }));
vi.mock('../store/chat', () => ({ useChatStore: {
  getState: () => ({
    chats: [{ id: 'a' }, { id: 'b' }], archived: [], messages: test.messages,
    loadChats: async () => { test.calls.push('list'); },
    loadArchived: async () => { test.calls.push('archived'); },
    openChat: test.openChat,
    apply: vi.fn(), reset: vi.fn(),
  }),
  setState: vi.fn(),
} }));
vi.mock('./settings-preload', async () => {
  const { syncQueue: queue } = await import('./sync-queue');
  return {
    settingsLoaders: { providers: async () => ({}), memory: async () => ({}) },
    syncSetting: async (key: string) => queue.add(`settings:${key}`, async () => { test.calls.push(`setting:${key}`); }),
  };
});
let stop: (() => void) | undefined;
beforeEach(() => {
  test.calls.length = 0; test.manifest = { epoch: 'one', revisions: {} }; test.messages = {}; test.token = 'session';
  test.openChat.mockReset().mockImplementation(async id => { test.calls.push(`chat:${id}`); test.messages[id] = []; });
});
afterEach(() => { stop?.(); stop = undefined; syncQueue.stop(); });

describe('authenticated client synchronization', () => {
  it('warms all chats then Settings once and shares a simultaneous manual refresh', async () => {
    stop = startClientSync();
    const first = refreshClientData(); expect(refreshClientData()).toBe(first);
    await first;
    expect(test.calls).toEqual(['list', 'archived', 'chat:a', 'chat:b', 'setting:providers', 'setting:memory']);
    expect(test.openChat.mock.calls.every(([, background]) => background === true)).toBe(true);
    expect(syncQueue.getState().busy).toBe(false);
  });
  it('does not fetch snapshots after an unchanged reconnect, then reads only a changed resource', async () => {
    stop = startClientSync(); await refreshClientData(); test.calls.length = 0;
    test.opened?.(); await new Promise(resolve => setTimeout(resolve, 0));
    expect(test.calls).toEqual([]);
    test.manifest.revisions.memory = 1; test.opened?.();
    await vi.waitFor(() => expect(test.calls).toEqual(['setting:memory']));
  });
  it('does a full round after server restart and consumes Settings events above routes', async () => {
    stop = startClientSync(); await refreshClientData(); test.calls.length = 0;
    test.manifest.epoch = 'two'; test.opened?.();
    await vi.waitFor(() => expect(test.calls).toContain('setting:memory'));
    test.calls.length = 0; test.events?.({ kind: 'resources-changed', keys: ['memory'] });
    await vi.waitFor(() => expect(test.calls).toEqual(['setting:memory']));
  });
  it('prioritizes an open conversation and avoids downloading it again on navigation', async () => {
    ensureChat('a'); await vi.waitFor(() => expect(test.calls).toEqual(['chat:a']));
    await new Promise(resolve => setTimeout(resolve, 0)); ensureChat('a');
    await new Promise(resolve => setTimeout(resolve, 0)); expect(test.calls).toEqual(['chat:a']);
    stop = startClientSync(); await refreshClientData();
  });
  it('does not issue an anonymous warmup', async () => {
    test.token = undefined; await refreshClientData(); expect(test.calls).toEqual([]);
  });
});
