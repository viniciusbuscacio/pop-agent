import { registerSW } from 'virtual:pwa-register';
import type { UpdateCheckResult } from './update-signal';

/**
 * One service worker registration, in one place (pop-agent.spec §15).
 *
 * An installed PWA only re-checks its service worker on navigation. On a phone
 * the app is resumed from suspension far more often than it is navigated, so a
 * shipped fix can go unseen for days and read as an app that stopped being
 * fixed. This module keeps the registration and drives three checks the
 * browser will not do on its own:
 *
 *   - a timer on the device-chosen interval (store/updates.ts);
 *   - `visibilitychange -> visible`, so resuming the PWA re-checks (the same
 *     trigger the SSE catch-up already relies on);
 *   - a manual "check now" from Settings.
 *
 * `registerSW` must run exactly once, which is why it lives here and not in a
 * component that could remount.
 */

let updateSW: ((reloadPage?: boolean) => Promise<void>) | undefined;
let registration: ServiceWorkerRegistration | undefined;
let started = false;
let timer: ReturnType<typeof setInterval> | undefined;
let intervalMs = 10 * 60 * 1000;

export function startUpdateChecks(onNeedRefresh: () => void): void {
  if (started) return;
  started = true;

  updateSW = registerSW({
    immediate: true,
    onNeedRefresh,
    onRegisteredSW(_scriptUrl, r) {
      registration = r;
      restartTimer();
    },
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void safeUpdate();
  });
}

export function setUpdateIntervalMs(ms: number): void {
  intervalMs = ms;
  restartTimer();
}

export async function checkForUpdateNow(): Promise<UpdateCheckResult> {
  if (registration === undefined) return 'unavailable';
  try {
    await registration.update();
    // update() resolves once the check is done; a new worker is now either
    // installing or already waiting. onNeedRefresh raises the reload banner
    // separately -- this return only drives the Settings feedback line.
    return registration.waiting !== null || registration.installing !== null
      ? 'update-found'
      : 'up-to-date';
  } catch {
    return 'error';
  }
}

export async function applyUpdate(): Promise<void> {
  // Reload exactly once, and only when the new worker actually owns the
  // page. The old 1.5s blind timer raced activation: on a phone the page
  // often reloaded still under the previous worker, the banner came back,
  // and Reload read as a button that must be pressed several times.
  let reloaded = false;
  const reload = (): void => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  };
  // Fires thanks to clientsClaim in the generated worker (vite.config.ts).
  navigator.serviceWorker?.addEventListener('controllerchange', reload, { once: true });

  // One press must jump to the *newest* build, not to whatever was waiting when
  // the banner first appeared. Between the banner and the click no check runs
  // unless the tab was hidden and shown, so a burst of builds leaves the
  // waiting worker stale -- and activating a stale worker only advances one
  // version, which is why catching up took a Reload per build (reload, update,
  // reload, update...). Re-check now: update() fetches the current sw.js and,
  // if it is newer, starts installing it, replacing the waiting worker. It
  // only becomes `waiting` once its precache finishes, so wait for that
  // before activating it.
  let target: ServiceWorker | undefined;
  try {
    await registration?.update();
    target = await newestWaitingWorker(registration);
  } catch {
    // Offline or unsupported: fall through to whatever is already waiting.
  }
  target ??= registration?.waiting ?? undefined;

  if (target !== undefined) {
    const worker = target;
    // Its own activation is as good a reload signal as the controller change.
    worker.addEventListener('statechange', () => {
      if (worker.state === 'activated') reload();
    });
    // Last resort for browsers that activate the worker but miss both events.
    // It starts only after the newest worker is fully installed, so it cannot
    // reload the page while that worker is still downloading its precache.
    setTimeout(reload, 8000);
    // The generated worker calls skipWaiting() on this message (vite.config.ts).
    worker.postMessage({ type: 'SKIP_WAITING' });
    return;
  }

  // Nothing waited (already current, or the direct check was unavailable):
  // hand off to the library, which messages its own tracked worker and reloads.
  await updateSW?.(true);
}

/**
 * The freshest worker to activate, after a re-check. `registration.update()`
 * resolves once the newest sw.js has been fetched and compared, but a worker
 * it finds newer is still *installing* then -- it reaches `waiting` only after
 * its precache completes. Grabbing `registration.waiting` too early would skip
 * to the previous build, so we wait for the in-flight worker to finish first.
 */
async function newestWaitingWorker(
  reg: ServiceWorkerRegistration | undefined,
): Promise<ServiceWorker | undefined> {
  if (reg === undefined) return undefined;
  const installing = reg.installing;
  if (installing !== null) {
    await new Promise<void>((resolve) => {
      const settle = (): void => {
        // 'installed' is the waiting state; the terminal states end the wait too.
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
      // The state can change between reading `reg.installing` and subscribing.
      settle();
    });
  }
  return reg.waiting ?? undefined;
}

function restartTimer(): void {
  if (timer !== undefined) clearInterval(timer);
  if (registration === undefined) return;
  timer = setInterval(() => void safeUpdate(), intervalMs);
}

async function safeUpdate(): Promise<void> {
  try {
    await registration?.update();
  } catch {
    // A failed check is not worth surfacing; the next tick tries again.
  }
}
