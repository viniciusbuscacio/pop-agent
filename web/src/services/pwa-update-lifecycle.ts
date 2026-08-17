type FallbackScheduler = (reload: () => void, delayMs: number) => unknown;

/** Returns one callback that invokes its action at most once. */
export function once(action: () => void): () => void {
  let invoked = false;
  return () => {
    if (invoked) return;
    invoked = true;
    action();
  };
}

/**
 * Re-checks and activates the newest fully installed worker. Kept separate from
 * the Vite virtual registration module so the slow-install lifecycle has a
 * direct deterministic test.
 */
export async function activateNewestServiceWorker(
  registration: ServiceWorkerRegistration | undefined,
  reload: () => void,
  scheduleFallback: FallbackScheduler = (callback, delay) => setTimeout(callback, delay),
): Promise<boolean> {
  if (registration === undefined) return false;

  let target: ServiceWorker | undefined;
  try {
    await registration.update();
    target = await newestWaitingWorker(registration);
  } catch {
    // Offline or unsupported: use an already installed waiting worker, if any.
  }
  target ??= registration.waiting ?? undefined;
  if (target === undefined) return false;

  const worker = target;
  worker.addEventListener('statechange', () => {
    if (worker.state === 'activated') reload();
  });
  // Starts only after newestWaitingWorker has observed installation complete.
  scheduleFallback(reload, 8000);
  worker.postMessage({ type: 'SKIP_WAITING' });
  return true;
}

/** Waits for an in-flight worker before consulting the waiting slot. */
async function newestWaitingWorker(
  registration: ServiceWorkerRegistration,
): Promise<ServiceWorker | undefined> {
  const installing = registration.installing;
  if (installing !== null) {
    await new Promise<void>((resolve) => {
      const settle = (): void => {
        if (
          installing.state === 'installed' ||
          installing.state === 'activated' ||
          installing.state === 'redundant'
        ) {
          installing.removeEventListener('statechange', settle);
          resolve();
        }
      };
      installing.addEventListener('statechange', settle);
      // The state can change between reading `installing` and subscribing.
      settle();
    });
  }
  return registration.waiting ?? undefined;
}
