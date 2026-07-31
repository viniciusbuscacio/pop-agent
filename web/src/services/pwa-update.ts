import { registerSW } from 'virtual:pwa-register';

/**
 * One service worker registration, in one place (popy.spec §15).
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

export type UpdateCheckResult = 'update-found' | 'up-to-date' | 'unavailable' | 'error';

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
  // The plugin runtime only reloads when its `controlling` event carries
  // isUpdate -- which a worker that was already waiting when this page loaded
  // (another tab, a previous session) does not. The button says Reload, so
  // reload: on the real controller change if it comes, on a timer if not.
  let reloaded = false;
  const reload = (): void => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  };
  navigator.serviceWorker?.addEventListener('controllerchange', reload, { once: true });
  setTimeout(reload, 1500);
  await updateSW?.(true);
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
