// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { activateNewestServiceWorker, once } from './pwa-update-lifecycle';

class Worker extends EventTarget {
  state: ServiceWorkerState;
  readonly postMessage = vi.fn();

  constructor(state: ServiceWorkerState) {
    super();
    this.state = state;
  }

  moveTo(state: ServiceWorkerState): void {
    this.state = state;
    this.dispatchEvent(new Event('statechange'));
  }
}

describe('PWA update activation', () => {
  it('waits for the newest worker to install before replacing an older waiting worker', async () => {
    const oldWaiting = new Worker('installed');
    const newest = new Worker('installing');
    const registration = {
      installing: newest,
      waiting: oldWaiting,
      update: vi.fn(() => Promise.resolve()),
    };
    const reload = vi.fn();
    const scheduleFallback = vi.fn();

    let completed = false;
    const activating = activateNewestServiceWorker(
      registration as unknown as ServiceWorkerRegistration,
      reload,
      scheduleFallback,
    ).then((result) => {
      completed = result;
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(completed).toBe(false);
    expect(oldWaiting.postMessage).not.toHaveBeenCalled();
    expect(newest.postMessage).not.toHaveBeenCalled();
    expect(scheduleFallback).not.toHaveBeenCalled();

    registration.waiting = newest;
    newest.moveTo('installed');
    await activating;

    expect(completed).toBe(true);
    expect(oldWaiting.postMessage).not.toHaveBeenCalled();
    expect(newest.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(scheduleFallback).toHaveBeenCalledWith(reload, 8000);
  });

  it('collapses controller, activation and fallback reload signals into one action', () => {
    const action = vi.fn();
    const reload = once(action);

    reload();
    reload();
    reload();

    expect(action).toHaveBeenCalledOnce();
  });

  it('notifies the caller when the activated worker changes state', async () => {
    const waiting = new Worker('installed');
    const registration = {
      installing: null,
      waiting,
      update: vi.fn(() => Promise.resolve()),
    };
    const reload = vi.fn();

    await activateNewestServiceWorker(
      registration as unknown as ServiceWorkerRegistration,
      reload,
      vi.fn(),
    );
    waiting.moveTo('activated');

    expect(reload).toHaveBeenCalledOnce();
  });
});
