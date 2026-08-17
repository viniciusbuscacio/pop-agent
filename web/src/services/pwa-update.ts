import { registerSW } from 'virtual:pwa-register';
import { activateNewestServiceWorker, once } from './pwa-update-lifecycle';
import type { UpdateCheckResult } from './update-signal';

/**
 * One service worker registration, in one place (docs/specs/Spec-Pop-General.md §15).
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
    if (intervalMs > 0 && document.visibilityState === 'visible') void safeUpdate();
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
  const reload = once(() => window.location.reload());
  // Fires thanks to clientsClaim in the generated worker (vite.config.ts).
  navigator.serviceWorker?.addEventListener('controllerchange', reload, { once: true });

  // One press must jump to the newest build, not an older worker that happened
  // to be waiting when the banner first appeared. The testable lifecycle waits
  // for any new installation, activates it, and starts its fallback only then.
  if (await activateNewestServiceWorker(registration, reload)) return;

  // Nothing waited (already current, or the direct check was unavailable):
  // hand off to the library, which messages its own tracked worker and reloads.
  await updateSW?.(true);
}

function restartTimer(): void {
  if (timer !== undefined) clearInterval(timer);
  timer = undefined;
  if (registration === undefined || intervalMs <= 0) return;
  timer = setInterval(() => void safeUpdate(), intervalMs);
}

async function safeUpdate(): Promise<void> {
  try {
    await registration?.update();
  } catch {
    // A failed check is not worth surfacing; the next tick tries again.
  }
}
