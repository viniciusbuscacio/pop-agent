import { useEffect, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { t } from '../i18n';

/**
 * Offers the new version instead of waiting for one (popy.spec §14).
 *
 * With silent auto-update an installed PWA keeps serving the previous build
 * until it is closed and reopened cold -- which on a phone can be days, and
 * looks exactly like an app that stopped being fixed. This asks.
 */
export function UpdatePrompt() {
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [update, setUpdate] = useState<(() => Promise<void>) | undefined>(undefined);

  useEffect(() => {
    const updateSW = registerSW({
      onNeedRefresh() {
        setUpdate(() => async () => {
          await updateSW(true);
        });
        setNeedsRefresh(true);
      },
    });
  }, []);

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
        onClick={() => void update?.()}
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
