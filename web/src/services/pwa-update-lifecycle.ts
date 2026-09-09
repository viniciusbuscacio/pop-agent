import { logUpdate, updateFailureReason } from './update-diagnostics';

/** Returns one callback that invokes its action at most once. */
export function once(action: () => void): () => void {
  let invoked = false;
  return () => { if (!invoked) { invoked = true; action(); } };
}

const checks = new WeakMap<ServiceWorkerRegistration, Promise<void>>();

/** Manual and automatic callers share one attempt; failure permits an explicit retry. */
export function createUpdateApplier(getRegistration: () => ServiceWorkerRegistration | undefined, reload: () => void): () => Promise<void> {
  let pending: Promise<void> | undefined;
  const reloadOnce = once(reload);
  return () => {
    if (!pending) {
      const started = Date.now();
      logUpdate('apply', 'start');
      pending = Promise.resolve()
        .then(() => activateNewestServiceWorker(getRegistration(), reloadOnce))
        .then(applied => { logUpdate('apply', applied ? 'success' : 'no-update', started); })
        .catch((error: unknown) => { logUpdate('apply', 'failed', started, undefined, error); throw error; })
        .finally(() => { pending = undefined; });
    }
    return pending;
  };
}

/** Browser checks cannot be aborted; late completion has no activation effects. */
export function checkServiceWorker(registration: ServiceWorkerRegistration): Promise<void> {
  const pending = checks.get(registration);
  if (pending) return pending;
  const started = Date.now();
  logUpdate('check', 'start');
  let timer: ReturnType<typeof setTimeout>;
  const check = Promise.race([
    Promise.resolve().then(() => registration.update()).then(() => undefined),
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Update check timed out')), 15_000); }),
  ]).then(() => { logUpdate('check', 'success', started, registration.waiting ?? registration.installing); })
    .catch((error: unknown) => { logUpdate('check', updateFailureReason(error) === 'timeout' ? 'timeout' : 'failed', started, undefined, error); throw error; })
    .finally(() => { clearTimeout(timer); checks.delete(registration); });
  checks.set(registration, check);
  return check;
}

/** Every phase settles and removes its listeners, including failure and timeout. */
function waitForWorker(worker: ServiceWorker, phase: 'installed' | 'activated', timeout: number, start?: () => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    let settled = false;
    logUpdate(phase, 'start', started, worker);
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.removeEventListener('statechange', changed);
      logUpdate(phase, !error ? 'success' : updateFailureReason(error) === 'timeout' ? 'timeout' : worker.state === 'redundant' ? 'discarded' : 'failed', started, worker, error);
      if (error) reject(error); else resolve();
    };
    const changed = () => {
      if (worker.state === 'redundant') finish(new Error('Update worker was discarded'));
      else if (worker.state === phase || worker.state === 'activated') finish();
    };
    const timer = setTimeout(() => finish(new Error('Update phase timed out')), timeout);
    worker.addEventListener('statechange', changed);
    try { start?.(); changed(); } catch (error) { finish(error instanceof Error ? error : new Error('Update activation failed')); }
  });
}

/** Activate only the newest completed installation, never blindly reload an old worker. */
export async function activateNewestServiceWorker(
  registration: ServiceWorkerRegistration | undefined,
  reload: () => void,
): Promise<boolean> {
  if (!registration) throw new Error('Update registration is not ready');
  try { await checkServiceWorker(registration); }
  catch (error) {
    // An installed offline update remains usable. A stalled check without one fails.
    if (!registration.waiting && !registration.installing) throw error;
  }
  const installing = registration.installing;
  if (installing) await waitForWorker(installing, 'installed', 60_000);
  const worker = registration.waiting ?? (installing?.state === 'activated' ? installing : undefined);
  if (!worker) return false;
  await waitForWorker(worker, 'activated', 10_000, () => {
    if (worker.state !== 'activated') worker.postMessage({ type: 'SKIP_WAITING' });
  });
  logUpdate('reload', 'start', Date.now(), worker);
  reload();
  return true;
}
