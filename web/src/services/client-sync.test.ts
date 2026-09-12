// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StreamEvent } from '@pop-agent/shared';
import { ensureChat, refreshClientData, startClientSync } from './client-sync';
import { syncQueue } from './sync-queue';
import { settingsResources } from './settings-resources';
import { apiRequest } from './api';
import { chatCache } from './chat-cache';

const test = vi.hoisted(() => ({
  calls: [] as string[],
  manifest: { epoch: 'one', revisions: {} as Record<string, number> },
  events: undefined as ((event: StreamEvent) => void) | undefined,
  opened: undefined as (() => void) | undefined,
  messages: {} as Record<string, unknown[]>,
  openChat: vi.fn(async (_id: string, _background?: boolean, _signal?: AbortSignal) => undefined),
  token: 'session' as string | undefined,
}));
vi.mock('./chat-memory', () => ({ selectMemoryChat: vi.fn(), startChatMemory: () => vi.fn() }));
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
    chats: [{ id: 'a' }, { id: 'b' }], archived: [{ id: 'old' }], messages: test.messages, listsLoaded: true,
    loadChats: async () => { test.calls.push('list'); },
    loadArchived: async () => { test.calls.push('archived'); },
    openChat: test.openChat,
    apply: vi.fn(), reset: vi.fn(),
  }),
  setState: vi.fn(),
} }));
vi.mock('./settings-preload', async () => {
  const { syncQueue: queue } = await import('./sync-queue');
  const { settingsResources: resources } = await import('./settings-resources');
  return {
    settingsLoaders: { providers: async () => ({}), memory: async () => ({}) },
    syncSetting: async (key: string) => queue.add(`settings:${key}`, async () => { test.calls.push(`setting:${key}`); resources.accept(key, {}); }),
  };
});
let stop: (() => void) | undefined;
beforeEach(() => {
  settingsResources.clear(); vi.mocked(apiRequest).mockReset().mockImplementation(async () => structuredClone(test.manifest));
  vi.mocked(chatCache.get).mockReset().mockResolvedValue(undefined);
  test.calls.length = 0; test.manifest = { epoch: 'one', revisions: {} }; test.messages = {}; test.token = 'session';
  test.openChat.mockReset().mockImplementation(async id => { test.calls.push(`chat:${id}`); test.messages[id] = []; });
});
afterEach(() => { stop?.(); stop = undefined; syncQueue.stop(); });

describe('authenticated client synchronization', () => {
  it('warms only active chats then Settings and shares a simultaneous manual refresh', async () => {
    stop = startClientSync();
    const first = refreshClientData(); expect(refreshClientData()).toBe(first);
    await first;
    expect(test.calls).toEqual(['list', 'archived', 'chat:a', 'chat:b', 'setting:providers', 'setting:memory']);
    expect(test.openChat.mock.calls.every(([, background]) => background === true)).toBe(true);
    expect(syncQueue.getState().busy).toBe(false);
    test.calls.length = 0;
    vi.mocked(apiRequest).mockClear();
    await refreshClientData();
    expect(test.calls).toEqual([]);
    expect(apiRequest).toHaveBeenCalledExactlyOnceWith('/sync');
  });
  it('loads an archived transcript on navigation and refreshes it only while selected', async () => {
    stop = startClientSync(); await refreshClientData(); test.calls.length = 0;
    const leave = ensureChat('old');
    await vi.waitFor(() => expect(test.calls).toContain('chat:old'));
    await vi.waitFor(() => expect(syncQueue.getState().busy).toBe(false));
    expect(test.calls).toEqual(['chat:old']);
    test.manifest.revisions['chat:old'] = 1;
    test.calls.length = 0; await refreshClientData();
    expect(test.calls).toContain('chat:old');
    leave(); test.calls.length = 0; await refreshClientData();
    expect(test.calls).not.toContain('chat:old');
  });
  it('does not download changed archived transcripts during reconnect or event recovery', async () => {
    stop = startClientSync(); await refreshClientData();
    const leave = ensureChat('old');
    await vi.waitFor(() => expect(test.calls).toContain('chat:old'));
    await vi.waitFor(() => expect(syncQueue.getState().busy).toBe(false));
    leave(); test.calls.length = 0;
    test.manifest.revisions['chat:old'] = 1;
    test.opened?.(); await new Promise(resolve => setTimeout(resolve, 0));
    test.events?.({ kind: 'resources-changed', keys: ['chat:old'] });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(test.calls).toEqual([]);
    ensureChat('old'); await vi.waitFor(() => expect(test.calls).toEqual(['chat:old']));
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
  it('refreshes only changed or missing snapshots', async () => {
    stop = startClientSync(); await refreshClientData(); test.calls.length = 0;
    test.manifest.revisions['chat:a'] = 1;
    test.manifest.revisions.memory = 1;
    await refreshClientData();
    expect(test.calls).toEqual(['chat:a', 'setting:memory']);
    test.calls.length = 0; delete test.messages.b;
    settingsResources.invalidate('providers');
    await refreshClientData();
    // A verified transcript evicted from RAM must not cause a warmup loop.
    expect(test.calls).toEqual(['setting:providers']);
    ensureChat('b');
    await vi.waitFor(() => expect(test.calls).toContain('chat:b'));
  });
  it('retries only the failed changed snapshot, not successful resources', async () => {
    stop = startClientSync(); await refreshClientData(); test.calls.length = 0;
    test.manifest.revisions['chat:a'] = 1; test.manifest.revisions.memory = 1;
    test.openChat.mockRejectedValueOnce(new Error('offline'));
    await refreshClientData();
    expect(syncQueue.getState().errors).toContain('chat:a');
    test.calls.length = 0; await refreshClientData();
    expect(test.calls).toEqual(['chat:a']);
  });
  it('does not acknowledge a revision that changes during a snapshot read', async () => {
    stop = startClientSync(); await refreshClientData();
    test.manifest.revisions['chat:a'] = 1;
    test.openChat.mockImplementationOnce(async id => {
      test.calls.push(`chat:${id}`); test.manifest.revisions['chat:a'] = 2;
    });
    await refreshClientData(); test.calls.length = 0;
    await refreshClientData(); expect(test.calls).toEqual(['chat:a']);
  });
  it('preserves snapshots and settles when the manifest cannot be read', async () => {
    stop = startClientSync(); await refreshClientData(); test.calls.length = 0;
    vi.mocked(apiRequest).mockRejectedValueOnce(new Error('offline'));
    await refreshClientData();
    expect(test.calls).toEqual([]);
    expect(test.messages.a).toEqual([]);
    expect(syncQueue.getState()).toEqual({ busy: false, errors: ['manifest'] });
    await refreshClientData(); expect(test.calls).toEqual([]);
  });
  it('checks navigation silently and skips unchanged warmed messages', async () => {
    stop = startClientSync(); await refreshClientData(); test.calls.length = 0;
    let finish!: (value: unknown) => void;
    vi.mocked(apiRequest).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const states: boolean[] = []; const unsubscribe = syncQueue.subscribe(() => states.push(syncQueue.getState().busy));
    ensureChat('a');
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    expect(syncQueue.getState().busy).toBe(false);
    finish(structuredClone(test.manifest));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(test.calls).toEqual([]); expect(states).not.toContain(true); unsubscribe();
  });
  it('spins only after navigation discovers a changed transcript', async () => {
    stop = startClientSync(); await refreshClientData(); test.calls.length = 0;
    test.manifest.revisions['chat:a'] = 1;
    let finish!: () => void;
    test.openChat.mockImplementationOnce(async id => { test.calls.push(`chat:${id}`); await new Promise<void>(resolve => { finish = resolve; }); });
    const leave = ensureChat('a');
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    expect(syncQueue.getState().busy).toBe(true);
    finish(); await vi.waitFor(() => expect(syncQueue.getState().busy).toBe(false));
    leave(); test.calls.length = 0; ensureChat('a');
    await new Promise(resolve => setTimeout(resolve, 0)); expect(test.calls).toEqual([]);
  });
  it('shares a check across a navigation remount without dropping its result', async () => {
    stop = startClientSync(); await refreshClientData(); test.calls.length = 0;
    test.manifest.revisions['chat:a'] = 1;
    const leave = ensureChat('a'); leave(); ensureChat('a');
    await vi.waitFor(() => expect(test.calls).toEqual(['chat:a']));
  });
});


it('revalidates an evicted transcript even when an old disk cache paints before the revision check', async () => {
  stop = startClientSync(); await refreshClientData(); test.calls.length = 0;
  delete test.messages.b;
  vi.mocked(chatCache.get).mockImplementation(async id => {
    if (id !== 'b') return undefined;
    // Simulate disk hydration completing before the manifest read. The disk
    // write may have failed even though this session verified the new revision.
    test.messages.b = [];
    return [];
  });
  ensureChat('b');
  await vi.waitFor(() => expect(test.calls).toEqual(['chat:b']));
});
