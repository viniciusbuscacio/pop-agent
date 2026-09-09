import { useEffect, useRef, useState } from 'react';
import { Pressable } from './controls';
import { t } from '../i18n';
import {
  applyUpdate,
  checkForUpdateNow,
  startUpdateChecks,
} from '../services/pwa-update';
import { setUpdateApplier, setUpdateChecker } from '../services/update-signal';

/**
 * Applies a new PWA build as soon as its service worker is ready
 * (docs/specs/Spec-Pop-General.md §14, §15).
 *
 * With silent auto-update an installed PWA keeps serving the previous build
 * until it is closed and reopened cold -- which on a phone can be days, and
 * looks exactly like an app that stopped being fixed. The actual checking is
 * driven by services/pwa-update (timer + resume + manual). The compact banner
 * is status/recovery UI, not an approval gate.
 */
export function UpdatePrompt() {
  const [state, setState] = useState<'idle' | 'applying' | 'failed'>('idle');
  const activating = useRef(false);

  async function activate(): Promise<void> {
    if (activating.current) return;
    activating.current = true;
    setState('applying');
    try {
      await applyUpdate();
      setState('idle');
    } catch {
      setState('failed');
    } finally {
      activating.current = false;
    }
  }

  useEffect(() => {
    startUpdateChecks(() => void activate());
    // This component is the app's only door to the virtual PWA module, so it
    // is also where the rest of the app is handed a way to trigger a check --
    // pull-to-refresh asks through services/update-signal.
    setUpdateChecker(checkForUpdateNow);
    setUpdateApplier(applyUpdate);
  }, []);

  if (state === 'idle') return null;

  return (
    <div
      role="status"
      data-testid="update-prompt"
      className="fixed top-3 right-3 z-50 flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-4 py-2 text-sm shadow-lg"
    >
      {state === 'applying' ? (
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
          <span>{t('update.failed')}</span>
          <Pressable
            type="button"
            data-testid="update-reload"
            onClick={() => void activate()}
            className="rounded bg-[var(--accent)] px-3 py-1 font-semibold text-[var(--accent-fg)]"
          >
            {t('update.retry')}
          </Pressable>
        </>
      )}
      {state === 'applying' ? (
        <span className="absolute right-0 -bottom-px left-0 h-0.5 overflow-hidden rounded-b-lg">
          <span className="block h-full w-1/3 animate-[updatebar_1s_ease-in-out_infinite] bg-[var(--accent)]" />
        </span>
      ) : null}
    </div>
  );
}
