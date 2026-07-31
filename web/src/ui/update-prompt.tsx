import { useEffect, useState } from 'react';
import { t } from '../i18n';
import { applyUpdate, setUpdateIntervalMs, startUpdateChecks } from '../services/pwa-update';
import { useUpdatesStore } from '../store/updates';

/**
 * Offers the new version instead of waiting for one (popy.spec §14, §15).
 *
 * With silent auto-update an installed PWA keeps serving the previous build
 * until it is closed and reopened cold -- which on a phone can be days, and
 * looks exactly like an app that stopped being fixed. The actual checking is
 * driven by services/pwa-update (timer + resume + manual); this component only
 * shows the banner and applies the update.
 */
export function UpdatePrompt() {
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const intervalMinutes = useUpdatesStore((state) => state.intervalMinutes);

  useEffect(() => {
    startUpdateChecks(() => setNeedsRefresh(true));
  }, []);

  useEffect(() => {
    setUpdateIntervalMs(intervalMinutes * 60 * 1000);
  }, [intervalMinutes]);

  if (!needsRefresh) return null;

  return (
    <div
      role="status"
      data-testid="update-prompt"
      className="fixed top-3 right-3 z-50 flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-4 py-2 text-sm shadow-lg"
    >
      <span>{t('update.available')}</span>
      <button
        type="button"
        data-testid="update-reload"
        onClick={() => void applyUpdate()}
        className="rounded bg-[var(--accent)] px-3 py-1 font-semibold text-[var(--accent-fg)]"
      >
        {t('update.reload')}
      </button>
      <button
        type="button"
        data-testid="update-dismiss"
        aria-label={t('update.later')}
        onClick={() => setNeedsRefresh(false)}
        className="text-[var(--muted)] hover:text-[var(--screen-fg)]"
      >
        ✕
      </button>
    </div>
  );
}
