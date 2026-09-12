// @vitest-environment happy-dom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { ensureSetting, settingsLoaders, syncSetting } from './settings-preload';
import { settingsResources } from './settings-resources';
import { syncQueue } from './sync-queue';
import { apiRequest } from './api';
import { passkeyService } from './passkey';

vi.mock('./api', () => ({ apiRequest: vi.fn(), apiDownload: vi.fn() }));
vi.mock('./settings-cache', () => ({ settingsCache: { read: vi.fn(async () => undefined), write: vi.fn(), clear: vi.fn() } }));
beforeEach(() => {
  syncQueue.stop(); settingsResources.clear();
  vi.mocked(apiRequest).mockReset().mockImplementation(async path => path === '/providers' ? { providers: [] } : { loaded: path });
  vi.spyOn(passkeyService, 'supported').mockReturnValue(true);
});
afterEach(() => { syncQueue.stop(); vi.restoreAllMocks(); });

describe('shared Settings reads', () => {
  it('loads every server-backed menu using reads only', async () => {
    await Promise.all(Object.keys(settingsLoaders).map(key => syncSetting(key)));
    expect(vi.mocked(apiRequest).mock.calls.map(([path]) => path).sort()).toEqual([
      '/providers', '/settings', '/memory', '/storage', '/backups', '/local-tools/machines',
      '/voice/models', '/models', '/server/info', '/update/status', '/about', '/auth/webauthn/credentials',
    ].sort());
    for (const [, options] of vi.mocked(apiRequest).mock.calls) expect(options?.method ?? 'GET').toBe('GET');
  });
  it('does not revalidate an already verified resource on route navigation', async () => {
    settingsResources.accept('navigation-test', { value: 'cached' });
    const loader = vi.fn(async () => ({})); ensureSetting('navigation-test', loader);
    await Promise.resolve(); expect(loader).not.toHaveBeenCalled();
    delete settingsLoaders['navigation-test'];
  });
  it('deduplicates a visible request with queued work and follows an actual invalidation', async () => {
    let finish!: (value: unknown) => void;
    const loader = vi.fn<() => Promise<unknown>>().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue({ doc: 'new' });
    const first = syncSetting('race-test', false, loader);
    const second = syncSetting('race-test', true, loader);
    await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce());
    settingsResources.invalidate('race-test'); finish({ doc: 'old' });
    await Promise.all([first, second]);
    expect(loader).toHaveBeenCalledTimes(2);
    expect(settingsResources.state('race-test').data).toEqual({ doc: 'new' });
  });
  it('keeps subscription failures local, preserves cached figures and retries explicitly', async () => {
    const key = 'subscription:openai-codex';
    settingsResources.accept(key, { plan: 'plus' });
    const failed = vi.fn(async () => { throw new Error('provider unavailable'); });
    await syncSetting(key, false, failed);
    expect(failed).toHaveBeenCalledOnce();
    expect(settingsResources.state(key)).toMatchObject({ data: { plan: 'plus' }, error: true, fresh: false });
    expect(syncQueue.getState()).toEqual({ busy: false, errors: [] });
    await syncSetting(key, true, async () => ({ plan: 'pro' }));
    expect(settingsResources.state(key)).toMatchObject({ data: { plan: 'pro' }, error: false, fresh: true });
  });
  it('finishes failed work without retrying it and continues other resources', async () => {
    const failed = vi.fn(async () => { throw new Error('offline'); });
    await Promise.all([syncSetting('failed-test', false, failed), syncSetting('good-test', false, async () => ({ ready: true }))]);
    expect(failed).toHaveBeenCalledOnce(); expect(syncQueue.getState().busy).toBe(false);
    expect(settingsResources.state('good-test').fresh).toBe(true);
  });
});
