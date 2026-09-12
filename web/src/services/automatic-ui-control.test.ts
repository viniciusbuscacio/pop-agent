// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { startAutomaticUiControl } from './automatic-ui-control';
const mock = vi.hoisted(() => ({ enabled: undefined as boolean | undefined, connected: false, listener: () => {}, start: vi.fn(), stop: vi.fn(), settings: vi.fn() }));
vi.mock('./api', () => ({ clientEnvironment: () => ({ platform: 'windows', appLabel: 'Web browser' }) }));
vi.mock('./integrations', () => ({ integrationsService: { settings: mock.settings }, restApiStatus: { getState: () => mock.enabled, subscribe: (fn: () => void) => { mock.listener = fn; return () => { mock.listener = () => {}; }; } } }));
vi.mock('./ui-control', () => ({ uiControl: { getState: () => ({ connected: mock.connected }), start: mock.start, stop: mock.stop } }));
let dispose: (() => void) | undefined;
beforeEach(() => { vi.useFakeTimers(); mock.enabled = undefined; mock.connected = false; mock.start.mockImplementation(async () => { mock.connected = true; }); mock.stop.mockImplementation(() => { mock.connected = false; }); mock.settings.mockResolvedValue({ serverEnabled: true }); });
afterEach(() => { dispose?.(); dispose = undefined; vi.clearAllMocks(); vi.useRealTimers(); });
it('automatically follows confirmed server state, with no registration while unknown or disabled', async () => {
  dispose = startAutomaticUiControl(); await vi.advanceTimersByTimeAsync(5000); expect(mock.start).not.toHaveBeenCalled();
  mock.enabled = true; mock.listener(); await vi.advanceTimersByTimeAsync(0);
  expect(mock.start).toHaveBeenCalledExactlyOnceWith('windows · Web browser');
  await vi.advanceTimersByTimeAsync(10000); expect(mock.start).toHaveBeenCalledTimes(1);
  mock.enabled = false; mock.listener(); expect(mock.connected).toBe(false);
  await vi.advanceTimersByTimeAsync(10000); expect(mock.start).toHaveBeenCalledTimes(1);
  mock.enabled = true; mock.listener(); await vi.advanceTimersByTimeAsync(0); expect(mock.start).toHaveBeenCalledTimes(2);
});
it('reconnects after transport loss and cleans up on sign-out or unmount', async () => {
  mock.enabled = true; dispose = startAutomaticUiControl(); await vi.advanceTimersByTimeAsync(0);
  mock.connected = false; await vi.advanceTimersByTimeAsync(5000); expect(mock.start).toHaveBeenCalledTimes(2);
  dispose(); dispose = undefined; expect(mock.connected).toBe(false); expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(10000); expect(mock.start).toHaveBeenCalledTimes(2);
});
it('rechecks the server switch after rejected registration', async () => {
  mock.enabled = true; mock.start.mockRejectedValueOnce(new Error('server disabled'));
  dispose = startAutomaticUiControl(); await vi.advanceTimersByTimeAsync(0); expect(mock.settings).toHaveBeenCalledOnce();
});
