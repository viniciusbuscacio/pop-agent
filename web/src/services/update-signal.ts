/**
 * A pointer to "ask the server whether there is a newer build", kept apart
 * from the module that knows how to do it.
 *
 * `services/pwa-update` imports `virtual:pwa-register`, which exists only
 * inside a vite build -- anything that imports it, directly or down a chain,
 * becomes unimportable from a test. That is what forced oauth-section out of
 * settings-page, and it would quietly do the same to any screen that wanted a
 * pull-to-refresh. So screens come through here, and the virtual module stays
 * behind ui/update-prompt alone, which registers the real check on mount.
 */
import { hardRefreshPage } from './hard-refresh';
import { logUpdate } from './update-diagnostics';

export type UpdateCheckResult = 'update-found' | 'up-to-date' | 'unavailable' | 'error';
type Checker = () => Promise<UpdateCheckResult>;
type Applier = () => Promise<void>;

/** Before the prompt mounts (and in tests) there is simply nothing to ask. */
let checker: Checker = () => Promise.resolve('unavailable');
let applier: Applier = () => Promise.resolve();

export function setUpdateChecker(fn: Checker): void {
  checker = fn;
}

export function setUpdateApplier(fn: Applier): void {
  applier = fn;
}

/**
 * Silent by design: a check that finds nothing must look like nothing
 * happened. When it does find a build, ui/update-prompt raises its own banner.
 */
export function checkForUpdate(): Promise<UpdateCheckResult> {
  return checker();
}

/** The footer refresh is the explicit “make this device current” action. */
export async function checkForAndApplyUpdate(): Promise<UpdateCheckResult> {
  const result = await checker();
  if (result === 'update-found') await applier();
  return result;
}

/** Explicit owner recovery only: fetch a fresh shell if worker activation fails.
 * Keep IndexedDB, credentials and worker registration; never silently reinstall. */
export async function refreshAppSoftware(): Promise<UpdateCheckResult> {
  const result = await checker();
  if (result === 'update-found') {
    try { await applier(); }
    catch (error) {
      logUpdate('apply', 'failed', Date.now(), undefined, error);
      logUpdate('reload', 'start');
      try { await hardRefreshPage(); }
      catch (failure) { logUpdate('reload', 'failed', Date.now(), undefined, failure); throw failure; }
    }
  }
  return result;
}
