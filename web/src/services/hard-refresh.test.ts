// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { clearHardRefreshMarker, hardRefreshPage, retryHardRefresh } from './hard-refresh';
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });
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

it('retries ten seconds apart, shares a cycle, and stops immediately after recovery', async () => {
  vi.useFakeTimers();
  const replace=vi.spyOn(window.location,'replace').mockImplementation(()=>{});
  const fetcher=vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(new Response('{}'));
  vi.stubGlobal('fetch',fetcher);
  const pending=retryHardRefresh();expect(retryHardRefresh()).toBe(pending);
  await vi.advanceTimersByTimeAsync(9999);expect(fetcher).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);await pending;
  expect(fetcher).toHaveBeenCalledTimes(2);expect(replace).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(100000);expect(fetcher).toHaveBeenCalledTimes(2);
});
it('stops after ten attempts without navigating and allows a later manual cycle', async () => {
  vi.useFakeTimers();const replace=vi.spyOn(window.location,'replace').mockImplementation(()=>{});
  const fetcher=vi.fn(async()=>new Response('',{status:503}));vi.stubGlobal('fetch',fetcher);
  const result=retryHardRefresh().catch(error=>error as Error);
  await vi.advanceTimersByTimeAsync(90000);expect(await result).toBeInstanceOf(Error);
  expect(fetcher).toHaveBeenCalledTimes(10);expect(replace).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(100000);expect(fetcher).toHaveBeenCalledTimes(10);
  fetcher.mockResolvedValue(new Response('{}'));await retryHardRefresh();expect(replace).toHaveBeenCalledOnce();
});
