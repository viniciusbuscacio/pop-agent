import { useState, useSyncExternalStore } from 'react';
import { Pressable } from '../ui/controls';
import { useLocation, useNavigate } from 'react-router-dom';
import { t } from '../i18n';
import { healthMonitor, type HealthState } from '../services/health';
import { useDismiss } from '../lib/dismiss';
import { retryHardRefresh } from '../services/hard-refresh';
import { useNotificationsStore } from '../store/notifications';

/**
 * The app header: the wordmark and the Settings gear. The sidebar always
 * shows it; on a phone, a screen that replaces the sidebar (Files) renders
 * its own copy, so the top of the app looks the same on every width.
 */
export function ShellHeader({
  className = '',
  settingsTestId = 'shell-settings',
}: {
  className?: string;
  settingsTestId?: string;
}) {
  const openSettings = useOpenSettings();
  return (
    <header
      className={`flex items-center justify-between gap-2 border-b border-[var(--border)] p-3 ${className}`}
    >
      <span className="font-semibold">{t('app.name')}</span>
      <Pressable
        type="button"
        data-testid={settingsTestId}
        aria-label={t('shell.settings')}
        onClick={openSettings}
        className="rounded-md p-2 text-[var(--key-fg-dim)] hover:bg-[var(--hover-overlay)]"
      >
        <GearIcon />
      </Pressable>
    </header>
  );
}

/**
 * The floating strip at the BOTTOM of the sidebar (docs/specs/Spec-Pop-General.md §14): wordmark,
 * health indicator and Settings, always visible while the list scrolls
 * behind it (the list's own padding keeps the last row clear).
 *
 * The bottom padding measures the phone rather than guessing at it:
 * env(safe-area-inset-bottom) is what the browser reports for THIS device --
 * 34px where a home indicator has to stay clear, 0 on a home-button iPhone,
 * an Android, or a desktop. Adding our own 0.75rem on top of that number
 * floated the row ~46px off the edge, which read as too high; taking 0.5rem
 * back off it drops the bar ~8px further while still leaving the indicator
 * its room. The max() is the floor for every screen that reports no inset --
 * they keep the plain 0.75rem and never move (Vinicius, 03/08).
 */
export function ShellFooter() {
  const openSettings = useOpenSettings();
  return (
    <footer
      data-testid="shell-footer"
      className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 border-t border-[var(--border)] bg-[var(--panel-bg)] px-5 pt-3 pb-[max(0.75rem,calc(env(safe-area-inset-bottom)-0.5rem))] md:px-3 md:pb-3"
    >
      <span className="font-semibold">{t('app.name')}</span>
      <span className="flex items-center gap-1">
        <HealthDot />
        <RefreshButton />
        <Pressable
          type="button"
          data-testid="shell-settings"
          aria-label={t('shell.settings')}
          onClick={openSettings}
          className="rounded-md p-2 text-[var(--key-fg-dim)] hover:bg-[var(--hover-overlay)]"
        >
          <GearIcon />
        </Pressable>
      </span>
    </footer>
  );
}

/** Carries the selected desktop pane through the full-screen Settings route. */
function useOpenSettings(): () => void {
  const navigate = useNavigate();
  const location = useLocation();
  return () =>
    void navigate('/settings', {
      state: { returnTo: `${location.pathname}${location.search}${location.hash}` },
    });
}

/** Retry a manual refresh quietly; only exhaustion posts a normal top toast. */
function RefreshButton() {
  const [busy, setBusy] = useState(false);
  const notify = useNotificationsStore(state => state.notify);
  async function refresh(): Promise<void> {
    if (busy) return;
    setBusy(true);
    try { await retryHardRefresh(); }
    catch { notify(t('shell.refreshFailed')); }
    finally { setBusy(false); }
  }
  return <>
    <Pressable
      type="button"
      data-testid="shell-refresh"
      aria-label={t('shell.refresh')}
      title={t('shell.refresh')}
      disabled={busy}
      onClick={() => void refresh()}
      className="rounded-md p-2 text-[var(--key-fg-dim)] hover:bg-[var(--hover-overlay)]"
    >
      <span className={busy ? 'block motion-safe:animate-spin' : 'block'}><RefreshIcon /></span>
    </Pressable>
  </>;
}

function RefreshIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M20 12a8 8 0 1 1-2.34-5.66"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path d="M20 3v4h-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The diagnosis words for the tooltip and the popover. */
function diagnosis(state: HealthState): string {
  if (state.kind === 'degraded') {
    return state.problems
      .map((problem) => (problem === 'provider' ? t('shell.health.provider') : t('shell.health.db')))
      .join(' · ');
  }
  return '';
}

/**
 * Silence means healthy: nothing renders while every check is ok. A problem
 * shows a small gently pulsing red button (opacity, never stroboscopic);
 * hover gives the tooltip, click pins the diagnosis open.
 *
 * Degraded only. A server the app cannot reach at all is the connection
 * banner's to announce (ui/connection-banner) -- it is not a diagnosis the
 * user can act on, and saying it twice would only make the loud one look
 * optional.
 */
function HealthDot() {
  const state = useSyncExternalStore(healthMonitor.subscribe, healthMonitor.getState);
  const [open, setOpen] = useState(false);
  useDismiss(open, () => setOpen(false));

  if (state.kind !== 'degraded') return null;
  const message = diagnosis(state);

  return (
    <span className="relative">
      <Pressable
        type="button"
        data-testid="health-dot"
        aria-label={t('shell.health.button')}
        title={message}
        onClick={() => setOpen((value) => !value)}
        className="block h-3 w-3 rounded-full bg-[var(--danger)] motion-safe:animate-[health-pulse_2s_ease-in-out_infinite]"
      />
      {open ? (
        <span
          role="status"
          className="absolute right-0 bottom-full mb-2 w-max max-w-56 rounded-md border border-[var(--border)] bg-[var(--panel-bg)] px-3 py-1.5 text-xs shadow-lg"
        >
          {message}
        </span>
      ) : null}
    </span>
  );
}

function GearIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6c.6-.25 1-.83 1-1.51V3a2 2 0 1 1 4 0v.09c0 .68.4 1.26 1 1.51.6.25 1.3.13 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.25.6.83 1 1.51 1H21a2 2 0 1 1 0 4h-.09c-.68 0-1.26.4-1.51 1Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}
