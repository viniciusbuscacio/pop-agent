// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

type Monitor = (typeof import('./health'))['healthMonitor'];

/**
 * The monitor is a module singleton with a timer, so every test takes a fresh
 * copy of the module rather than inheriting the previous one's verdict.
 */
async function freshMonitor(): Promise<Monitor> {
  vi.resetModules();
  const { healthMonitor } = await import('./health');
  return healthMonitor;
}

function setOnLine(value: boolean): void {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => value });
}

function setHidden(value: boolean): void {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => value });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setOnLine(true);
  setHidden(false);
  history.replaceState(null, '', '/');
});

describe('healthMonitor', () => {
  it('calls the server unreachable when the probe never lands', async () => {
    const monitor = await freshMonitor();
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('failed to fetch')));

    const unsubscribe = monitor.subscribe(() => undefined);
    await vi.waitFor(() => expect(monitor.getState()).toEqual({ kind: 'offline' }));
    unsubscribe();
  });

  it('blames the device, and spends no request, when the radio is down', async () => {
    const monitor = await freshMonitor();
    const fetchMock = vi.fn(() => Promise.resolve(new Response('{}')));
    vi.stubGlobal('fetch', fetchMock);
    setOnLine(false);

    const unsubscribe = monitor.subscribe(() => undefined);
    await vi.waitFor(() => expect(monitor.getState()).toEqual({ kind: 'device-offline' }));
    expect(fetchMock).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('reports the sick parts when the server answers but is degraded', async () => {
    const monitor = await freshMonitor();
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        new Response(JSON.stringify({ server: 'ok', provider: 'error', db: 'ok' })),
      ),
    );

    const unsubscribe = monitor.subscribe(() => undefined);
    await vi.waitFor(() =>
      expect(monitor.getState()).toEqual({ kind: 'degraded', problems: ['provider'] }),
    );
    unsubscribe();
  });

  it('probes nothing while the page is hidden, and probes at once when it returns', async () => {
    const monitor = await freshMonitor();
    const fetchMock = vi.fn(() => Promise.resolve(new Response('{}')));
    vi.stubGlobal('fetch', fetchMock);
    setHidden(true);

    const unsubscribe = monitor.subscribe(() => undefined);
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();

    // Coming back from the background must not wait out an interval: what is
    // on screen after a suspension would otherwise be a verdict from before it.
    setHidden(false);
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    unsubscribe();
  });

  it('retries quickly after a restart and caps at ten seconds', async () => {
    const monitor = await freshMonitor();
    vi.useFakeTimers();
    const fetchMock = vi.fn(() => Promise.reject(new TypeError('failed to fetch')));
    vi.stubGlobal('fetch', fetchMock);

    const unsubscribe = monitor.subscribe(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(monitor.getState()).toEqual({ kind: 'offline' });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(8_000);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(6);
    unsubscribe();
  });

  it('keeps a healthy server at the keepalive pace', async () => {
    const monitor = await freshMonitor();
    vi.useFakeTimers();
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ server: 'ok', provider: 'ok', db: 'ok' }))),
    );
    vi.stubGlobal('fetch', fetchMock);

    const unsubscribe = monitor.subscribe(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('lets a real request speak before the next probe, both ways', async () => {
    const monitor = await freshMonitor();
    // A probe that never settles: only the reports below move the state.
    vi.stubGlobal('fetch', () => new Promise<Response>(() => undefined));

    const unsubscribe = monitor.subscribe(() => undefined);
    monitor.reportUnreachable();
    expect(monitor.getState()).toEqual({ kind: 'offline' });

    monitor.reportReachable();
    expect(monitor.getState()).toEqual({ kind: 'ok' });
    unsubscribe();
  });

  it('keeps a faked outage faked, whatever the real traffic says', async () => {
    // The hatch exists to photograph the banner on a healthy server, so the
    // login screen's own successful /auth/state must not wash it away.
    history.replaceState(null, '', '/?health=mock-offline');
    const monitor = await freshMonitor();
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('{}')));

    const unsubscribe = monitor.subscribe(() => undefined);
    await vi.waitFor(() => expect(monitor.getState()).toEqual({ kind: 'offline' }));

    monitor.reportReachable();
    expect(monitor.getState()).toEqual({ kind: 'offline' });
    unsubscribe();
  });
});
