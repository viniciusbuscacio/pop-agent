// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { settingsResources } from './settings-resources';
import { settingsCache } from './settings-cache';
vi.mock('./settings-cache', () => ({ settingsCache: { read: vi.fn(), write: vi.fn(), clear: vi.fn() } }));
beforeEach(() => { settingsResources.clear(); vi.clearAllMocks(); vi.mocked(settingsCache.read).mockResolvedValue(undefined); });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }

describe('Settings snapshot resources', () => {
  it('paints a persistent snapshot before the server and replaces it on success', async () => {
    vi.mocked(settingsCache.read).mockResolvedValue({ version: 1, savedAt: 1, data: { doc: 'cached' } });
    const network = deferred<unknown>();
    const request = settingsResources.load('memory', () => network.promise);
    await Promise.resolve();
    expect(settingsResources.state('memory')).toMatchObject({ data: { doc: 'cached' }, fresh: false, loading: true });
    network.resolve({ doc: 'server' }); await request;
    expect(settingsResources.state('memory')).toMatchObject({ data: { doc: 'server' }, fresh: true, loading: false });
    expect(settingsCache.write).toHaveBeenCalledWith('memory', expect.objectContaining({ data: { doc: 'server' } }));
  });
  it('deduplicates concurrent reads', async () => {
    const result = deferred<unknown>(); const loader = vi.fn(() => result.promise);
    const first = settingsResources.load('settings', loader);
    const second = settingsResources.load('settings', loader);
    await Promise.resolve(); expect(loader).toHaveBeenCalledOnce();
    result.resolve({}); await Promise.all([first, second]);
  });
  it('preserves last good data after failure and recovers on retry', async () => {
    settingsResources.accept('settings', { value: 'old' });
    await settingsResources.load('settings', () => Promise.reject(new Error('offline')));
    expect(settingsResources.state('settings')).toMatchObject({ data: { value: 'old' }, error: true, fresh: false });
    await settingsResources.load('settings', () => Promise.resolve({ value: 'new' }));
    expect(settingsResources.state('settings')).toMatchObject({ data: { value: 'new' }, error: false, fresh: true });
  });
  it('ignores an old read after a successful save or newer invalidation', async () => {
    const old = deferred<unknown>(); const request = settingsResources.load('memory', () => old.promise);
    settingsResources.accept('memory', { doc: 'saved' });
    old.resolve({ doc: 'obsolete' }); await request;
    expect(settingsResources.state('memory').data).toEqual({ doc: 'saved' });
    const slow = deferred<unknown>(); const pending = settingsResources.load('memory', () => slow.promise);
    await settingsResources.load('memory', () => Promise.resolve({ doc: 'newer' }), true);
    slow.resolve({ doc: 'old' }); await pending;
    expect(settingsResources.state('memory').data).toEqual({ doc: 'newer' });
  });
  it('does not restore private data after logout', async () => {
    const result = deferred<unknown>(); const request = settingsResources.load('memory', () => result.promise);
    settingsResources.clear(); result.resolve({ doc: 'private' }); await request;
    expect(settingsResources.state('memory').data).toBeUndefined();
    expect(settingsCache.write).not.toHaveBeenCalled();
  });
  it('does not let slow disk hydration overwrite a newer server snapshot', async () => {
    const disk = deferred<Awaited<ReturnType<typeof settingsCache.read>>>();
    vi.mocked(settingsCache.read).mockReturnValue(disk.promise);
    await settingsResources.load('memory', () => Promise.resolve({ doc: 'new' }));
    disk.resolve({ version: 1, savedAt: 1, data: { doc: 'old' } }); await Promise.resolve();
    expect(settingsResources.state('memory').data).toEqual({ doc: 'new' });
  });
});
