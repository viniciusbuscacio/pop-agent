// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activateNewestServiceWorker, checkServiceWorker, createUpdateApplier } from './pwa-update-lifecycle';
import { updateDiagnostics } from './update-diagnostics';

class Worker extends EventTarget {
  readonly postMessage = vi.fn();
  constructor(public state: ServiceWorkerState) { super(); }
  moveTo(state: ServiceWorkerState): void {
    this.state = state;
    this.dispatchEvent(new Event('statechange'));
  }
}
function registration(installing: Worker | null = null, waiting: Worker | null = null) {
  return { installing, waiting, update: vi.fn(async () => undefined) };
}
const asRegistration = (value: ReturnType<typeof registration>) => value as unknown as ServiceWorkerRegistration;
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('bounded PWA update activation', () => {
  it('waits for the newest installation and activation before reloading', async () => {
    const old = new Worker('installed');
    const newest = new Worker('installing');
    const reg = registration(newest, old);
    const reload = vi.fn();
    const attempt = activateNewestServiceWorker(asRegistration(reg), reload);
    await vi.advanceTimersByTimeAsync(5000);
    expect(old.postMessage).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    reg.waiting = newest;
    newest.moveTo('installed');
    await vi.advanceTimersByTimeAsync(0);
    expect(newest.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(reload).not.toHaveBeenCalled();
    newest.moveTo('activated');
    expect(await attempt).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('times out a stuck check and ignores its late completion', async () => {
    const reg = registration();
    let finish!: () => void;
    reg.update.mockImplementation(() => new Promise(resolve => { finish = () => resolve(undefined); }));
    const reload = vi.fn();
    const rejected = expect(activateNewestServiceWorker(asRegistration(reg), reload)).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(15_000);
    await rejected;
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(reload).not.toHaveBeenCalled();
  });
  it('times out installation without activating an older waiting worker or leaking listeners', async () => {
    const installing = new Worker('installing');
    const older = new Worker('installed');
    const remove = vi.spyOn(installing, 'removeEventListener');
    const reload = vi.fn();
    const rejected = expect(activateNewestServiceWorker(asRegistration(registration(installing, older)), reload)).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(60_000);
    await rejected;
    expect(remove).toHaveBeenCalled();
    installing.moveTo('activated');
    expect(older.postMessage).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });
  it('fails a stalled activation instead of blindly reloading the old app', async () => {
    const worker = new Worker('installed');
    const reload = vi.fn();
    const rejected = expect(activateNewestServiceWorker(asRegistration(registration(null, worker)), reload)).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(10_000);
    await rejected;
    worker.moveTo('activated');
    expect(reload).not.toHaveBeenCalled();
    expect(JSON.parse(updateDiagnostics()).entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'activated', outcome: 'timeout', reason: 'timeout', worker: 'installed', elapsedMs: 10_000 }),
    ]));
    expect(vi.getTimerCount()).toBe(0);
  });
  it('fails discarded installations and does not fall back to an older worker', async () => {
    const worker = new Worker('installing');
    const old = new Worker('installed');
    const rejected = expect(activateNewestServiceWorker(asRegistration(registration(worker, old)), vi.fn())).rejects.toThrow('discarded');
    await vi.advanceTimersByTimeAsync(0);
    worker.moveTo('redundant');
    await rejected;
    expect(old.postMessage).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('settles an already-current app without reloading', async () => {
    const reload = vi.fn();
    expect(await activateNewestServiceWorker(asRegistration(registration()), reload)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
  it('shares automatic/manual activation, permits retry, and reloads once per page', async () => {
    const worker = new Worker('installed');
    const reg = registration(null, worker);
    const reload = vi.fn();
    const apply = createUpdateApplier(() => asRegistration(reg), reload);
    const first = apply();
    expect(apply()).toBe(first);
    const rejected = expect(first).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(10_000);
    await rejected;
    const retry = apply();
    expect(retry).not.toBe(first);
    await vi.advanceTimersByTimeAsync(0);
    worker.moveTo('activated');
    await retry;
    await apply();
    expect(reload).toHaveBeenCalledOnce();
  });
  it('deduplicates overlapping checks', async () => {
    const reg = registration();
    const first = checkServiceWorker(asRegistration(reg));
    expect(checkServiceWorker(asRegistration(reg))).toBe(first);
    await first;
    expect(reg.update).toHaveBeenCalledOnce();
  });
});
