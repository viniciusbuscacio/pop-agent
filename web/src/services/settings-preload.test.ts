// @vitest-environment happy-dom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { preloadSettings } from './settings-preload';
import { settingsResources } from './settings-resources';
import { apiRequest } from './api';
import { session } from './session';
import { passkeyService } from './passkey';

vi.mock('./api', () => ({ apiRequest: vi.fn(), apiDownload: vi.fn() }));
vi.mock('./settings-cache', () => ({ settingsCache: { read: vi.fn(async () => undefined), write: vi.fn(), clear: vi.fn() } }));
beforeEach(() => {
  settingsResources.clear();
  vi.mocked(apiRequest).mockReset().mockImplementation(async (path) => path === '/providers' ? { providers: [] } : { loaded: path });
  vi.spyOn(session, 'token').mockReturnValue('test-session');
  vi.spyOn(passkeyService, 'supported').mockReturnValue(true);
});
afterEach(() => vi.restoreAllMocks());

describe('Settings index preload', () => {
  it('loads every server-backed menu using reads only, before visiting destinations', async () => {
    await preloadSettings();
    expect(vi.mocked(apiRequest).mock.calls.map(([path]) => path).sort()).toEqual([
      '/providers', '/settings', '/memory', '/storage', '/backups', '/local-tools/machines',
      '/voice/models', '/models', '/server/info', '/update/status', '/about', '/auth/webauthn/credentials',
    ].sort());
    for (const [, options] of vi.mocked(apiRequest).mock.calls) expect(options?.method ?? 'GET').toBe('GET');
    expect(settingsResources.state('providers')).toMatchObject({ fresh: true, data: { providers: [] } });
    expect(settingsResources.state('memory')).toMatchObject({ fresh: true, data: { loaded: '/memory' } });
  });
  it('shares pending reads with navigation, then permits destination revalidation', async () => {
    let finish!: (value: unknown) => void;
    vi.mocked(apiRequest).mockImplementation(async (path) => path === '/providers'
      ? new Promise((resolve) => { finish = resolve; }) : {});
    const preload = preloadSettings();
    const navigationLoader = vi.fn(async () => ({ providers: [] }));
    const navigation = settingsResources.load('providers', navigationLoader);
    await vi.waitFor(() => expect(finish).toBeDefined());
    finish({ providers: [] });
    await Promise.all([preload, navigation]);
    expect(navigationLoader).not.toHaveBeenCalled();
    await settingsResources.load('providers', navigationLoader);
    expect(navigationLoader).toHaveBeenCalledOnce();
  });
  it('keeps other menus available when one request fails', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path) => {
      if (path === '/memory') throw new Error('offline');
      return path === '/providers' ? { providers: [] } : {};
    });
    await preloadSettings();
    expect(settingsResources.state('memory').error).toBe(true);
    expect(settingsResources.state('providers').fresh).toBe(true);
    expect(settingsResources.state('settings').fresh).toBe(true);
  });
  it('warms supported subscription usage after provider discovery', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path) => path === '/providers'
      ? { providers: [{ id: 'openai-codex', configured: true }] } : {});
    await preloadSettings();
    expect(settingsResources.state('subscription:openai-codex').fresh).toBe(true);
  });
  it('does not preload without an owner session', async () => {
    vi.mocked(session.token).mockReturnValue(undefined);
    await preloadSettings();
    expect(apiRequest).not.toHaveBeenCalled();
  });
  it('does not start subscription follow-ups after logout', async () => {
    let finish!: (value: unknown) => void;
    vi.mocked(apiRequest).mockImplementation(async (path) => path === '/providers'
      ? new Promise((resolve) => { finish = resolve; }) : {});
    const preload = preloadSettings();
    await vi.waitFor(() => expect(finish).toBeDefined());
    session.clear();
    finish({ providers: [{ id: 'openai-codex', configured: true }] });
    await preload;
    expect(settingsResources.state('subscription:openai-codex').data).toBeUndefined();
    expect(vi.mocked(apiRequest).mock.calls.some(([path]) => path.includes('subscription-usage'))).toBe(false);
  });
});
