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
type Checker = () => Promise<unknown>;

/** Before the prompt mounts (and in tests) there is simply nothing to ask. */
let checker: Checker = () => Promise.resolve(undefined);

export function setUpdateChecker(fn: Checker): void {
  checker = fn;
}

/**
 * Silent by design: a check that finds nothing must look like nothing
 * happened. When it does find a build, ui/update-prompt raises its own banner.
 */
export function checkForUpdate(): Promise<unknown> {
  return checker();
}
