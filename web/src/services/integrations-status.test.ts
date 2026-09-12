// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { apiRequest } from './api';
import { integrationsService, restApiStatus } from './integrations';
vi.mock('./api', () => ({ apiRequest: vi.fn() }));
const subscriptions: (() => void)[] = [];
afterEach(() => { subscriptions.splice(0).forEach(stop => stop()); vi.clearAllMocks(); vi.useRealTimers(); });
it('shares polling, updates after confirmed writes and hides unknown state', async () => {
  vi.useFakeTimers();
  vi.mocked(apiRequest).mockResolvedValue({ serverEnabled: true, clientEnabled: true });
  subscriptions.push(restApiStatus.subscribe(vi.fn()), restApiStatus.subscribe(vi.fn()));
  await vi.advanceTimersByTimeAsync(0);
  expect(apiRequest).toHaveBeenCalledTimes(1);
  expect(restApiStatus.getState()).toBe(true);
  vi.mocked(apiRequest).mockResolvedValueOnce({ serverEnabled: false, clientEnabled: true });
  await integrationsService.updateSettings({ serverEnabled: false });
  expect(restApiStatus.getState()).toBe(false);
  vi.mocked(apiRequest).mockRejectedValueOnce(new Error('offline'));
  await vi.advanceTimersByTimeAsync(60_000);
  expect(restApiStatus.getState()).toBeUndefined();
  subscriptions.splice(0).forEach(stop => stop());
  expect(vi.getTimerCount()).toBe(0);
});
it('a stale settings read cannot override a later successful toggle', async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(apiRequest).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const read = integrationsService.settings();
  vi.mocked(apiRequest).mockResolvedValueOnce({ serverEnabled: false, clientEnabled: true });
  await integrationsService.updateSettings({ serverEnabled: false });
  finish({ serverEnabled: true, clientEnabled: true });
  await read;
  expect(restApiStatus.getState()).toBe(false);
});
