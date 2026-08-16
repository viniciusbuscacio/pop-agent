import { useEffect, useState } from 'react';
import { Pressable } from './controls';
import { t } from '../i18n';
import {
  applyUpdate,
  checkForUpdateNow,
  setUpdateIntervalMs,
  startUpdateChecks,
} from '../services/pwa-update';
import { setUpdateApplier, setUpdateChecker } from '../services/update-signal';
import { useUpdatesStore } from '../store/updates';

/**
 * Offers the new version instead of waiting for one (pop-agent.spec §14, §15).
 *
 * With silent auto-update an installed PWA keeps serving the previous build
 * until it is closed and reopened cold -- which on a phone can be days, and
 * looks exactly like an app that stopped being fixed. The actual checking is
 * driven by services/pwa-update (timer + resume + manual); this component only
 * shows the banner and applies the update.
 */
export function UpdatePrompt() {
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [reloading, setReloading] = useState(false);
  const checksEnabled = useUpdatesStore((state) => state.enabled);
  const intervalMinutes = useUpdatesStore((state) => state.intervalMinutes);

  useEffect(() => {
    startUpdateChecks(() => setNeedsRefresh(true));
    // This component is the app's only door to the virtual PWA module, so it
    // is also where the rest of the app is handed a way to trigger a check --
    // pull-to-refresh asks through services/update-signal.
    setUpdateChecker(checkForUpdateNow);
    setUpdateApplier(applyUpdate);
  }, []);

  useEffect(() => {
    setUpdateIntervalMs(checksEnabled ? intervalMinutes * 60 * 1000 : 0);
  }, [checksEnabled, intervalMinutes]);

  if (!needsRefresh) return null;

  return (
    <div
      role="status"
      data-testid="update-prompt"
      className="fixed top-3 right-3 z-50 flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-4 py-2 text-sm shadow-lg"
    >
      {reloading ? (
        <>
          <span
            aria-hidden="true"
            className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent"
          />
          <span data-testid="update-reloading" role="status">
            {t('update.reloading')}
          </span>
        </>
      ) : (
        <>
          <span>{t('update.available')}</span>
          <Pressable
            type="button"
            data-testid="update-reload"
            onClick={() => {
              // The click answers at once: spinner in, buttons out, and any
              // extra taps land on nothing while the new version takes over.
              setReloading(true);
              void applyUpdate();
            }}
            className="rounded bg-[var(--accent)] px-3 py-1 font-semibold text-[var(--accent-fg)]"
          >
            {t('update.reload')}
          </Pressable>
          <Pressable
            type="button"
            data-testid="update-dismiss"
            aria-label={t('update.later')}
            onClick={() => setNeedsRefresh(false)}
            className="text-[var(--muted)] hover:text-[var(--screen-fg)]"
          >
            ✕
          </Pressable>
        </>
      )}
      {reloading ? (
        <span className="absolute right-0 -bottom-px left-0 h-0.5 overflow-hidden rounded-b-lg">
          <span className="block h-full w-1/3 animate-[updatebar_1s_ease-in-out_infinite] bg-[var(--accent)]" />
        </span>
      ) : null}
    </div>
  );
}
