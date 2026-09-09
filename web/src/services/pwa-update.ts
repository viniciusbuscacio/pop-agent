import { registerSW } from 'virtual:pwa-register';
import { checkServiceWorker, createUpdateApplier } from './pwa-update-lifecycle';
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
 *   - a fixed ten-minute timer;
 *   - `visibilitychange -> visible`, so resuming the PWA re-checks (the same
 *     trigger the SSE catch-up already relies on);
 *   - a manual "check now" from Settings.
 *
 * `registerSW` must run exactly once, which is why it lives here and not in a
 * component that could remount.
 */

let registration: ServiceWorkerRegistration | undefined;
let started = false;
let timer: ReturnType<typeof setInterval> | undefined;
const UPDATE_INTERVAL_MS = 10 * 60 * 1000;

export function startUpdateChecks(onNeedRefresh: () => void): void {
  if (started) return;
  started = true;

  registerSW({
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

export async function checkForUpdateNow(): Promise<UpdateCheckResult> {
  if (registration === undefined) return 'unavailable';
  try {
    await checkServiceWorker(registration);
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

export const applyUpdate = createUpdateApplier(() => registration, () => window.location.reload());

function restartTimer(): void {
  if (timer !== undefined) clearInterval(timer);
  timer = undefined;
  if (registration === undefined) return;
  timer = setInterval(() => void safeUpdate(), UPDATE_INTERVAL_MS);
}

async function safeUpdate(): Promise<void> {
  try {
    if (registration) await checkServiceWorker(registration);
  } catch {
    // A failed check is not worth surfacing; the next tick tries again.
  }
}
