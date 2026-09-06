import { afterEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => vi.fn());
vi.mock('./auth', () => ({ authService: { state } }));
import { readSetupState } from './setup-state';
afterEach(() => { vi.useRealTimers(); state.mockReset(); });
describe('setup state recovery', () => {
  it('recovers from transient failures and malformed responses', async () => {
    vi.useFakeTimers();
    state.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce('<html>proxy</html>')
      .mockResolvedValue({ setupDone: false, setupMode: 'account' });
    const pending = readSetupState(new AbortController().signal);
    await vi.runAllTimersAsync();
    expect(await pending).toEqual({ setupDone: false, setupMode: 'account' });
    expect(state).toHaveBeenCalledTimes(3);
  });
  it('times out stalled requests and bounds repeated failures', async () => {
    vi.useFakeTimers();
    state.mockImplementation((signal: AbortSignal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('timeout', 'AbortError')));
    }));
    const pending = expect(readSetupState(new AbortController().signal)).rejects.toThrow('timeout');
    await vi.runAllTimersAsync(); await pending;
    expect(state).toHaveBeenCalledTimes(6);
  });
  it('cancels an in-flight request when the screen is left', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    state.mockImplementation((signal: AbortSignal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')));
    }));
    const pending = expect(readSetupState(controller.signal)).rejects.toThrow();
    controller.abort(); await pending; await vi.runAllTimersAsync();
    expect(state).toHaveBeenCalledTimes(1);
  });
});
