// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { clearHardRefreshMarker, hardRefreshPage } from './hard-refresh';
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });
it('forces a new document URL while retaining route, parameters, fragment and credentials', async () => {
  window.history.replaceState(null, '', '/rest-api?view=server#tokens');
  localStorage.setItem('pop-agent.token', 'test-session');
  const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
  await hardRefreshPage();
  const target = new URL(replace.mock.calls[0]![0]);
  expect(target.pathname).toBe('/rest-api');
  expect(target.searchParams.get('view')).toBe('server');
  expect(target.searchParams.get('_pop_refresh')).toBeTruthy();
  expect(target.hash).toBe('#tokens');
  expect(localStorage.getItem('pop-agent.token')).toBe('test-session');
  expect(fetch).toHaveBeenCalledWith('/healthz', expect.objectContaining({ cache: 'no-store' }));
});
it('keeps the current page when the server is unavailable', async () => {
  const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
  await expect(hardRefreshPage()).rejects.toThrow();
  expect(replace).not.toHaveBeenCalled();
});
it('removes only the refresh marker before the router starts', () => {
  window.history.replaceState({ keep: true }, '', '/rest-api?view=server&_pop_refresh=nonce#tokens');
  clearHardRefreshMarker();
  expect(window.location.pathname + window.location.search + window.location.hash).toBe('/rest-api?view=server#tokens');
  expect(window.history.state).toEqual({ keep: true });
});
