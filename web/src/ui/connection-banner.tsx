import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Pressable } from './controls';
import { t } from '../i18n';
import { healthMonitor } from '../services/health';

/**
 * Says out loud that the app cannot reach its server (pop-agent.spec §14).
 *
 * The health dot in the sidebar footer is a diagnosis for problems the user
 * could act on. An unreachable server is not a diagnosis, it is a wall: every
 * screen still paints from the service worker's cache, so the app looks alive
 * and only the answers stop coming, and a 12px dot at the bottom of a list is
 * not where anyone looks for the reason. Hence a full-width bar at the top,
 * which is also the one place a phone in standalone mode always shows.
 *
 * A bar, not a modal: the conversations already loaded are still readable, and
 * blocking them would take away the only thing that still works.
 *
 * Three states, because the user's next move differs in each. Their own
 * network being down is theirs to fix; the server being down is not, and
 * saying which is which is what stops people from restarting a working router.
 * Coming back is worth a word too -- an outage that ends in silence leaves you
 * poking at the app to find out whether it is safe to type again.
 */
const RECOVERED_MS = 3_000;

export function ConnectionBanner() {
  const state = useSyncExternalStore(healthMonitor.subscribe, healthMonitor.getState);
  const [recovered, setRecovered] = useState(false);
  // Only an outage we actually announced earns the "back online" note; a
  // healthy app that has never dropped must not flash one on every boot.
  const announced = useRef(false);

  const down = state.kind === 'offline' || state.kind === 'device-offline';

  useEffect(() => {
    if (down) {
      announced.current = true;
      setRecovered(false);
      return;
    }
    if (!announced.current) return;
    announced.current = false;
    setRecovered(true);
    const timer = setTimeout(() => setRecovered(false), RECOVERED_MS);
    return () => clearTimeout(timer);
  }, [down]);

  if (!down && !recovered) return null;

  return (
    <div
      data-testid="connection-banner"
      data-state={down ? state.kind : 'recovered'}
      role={down ? 'alert' : 'status'}
      // The inset padding is the notch on a phone in standalone mode and zero
      // everywhere else, so the bar clears the status bar without guessing.
      className="fixed inset-x-0 top-0 z-[60] border-b border-[var(--border)] bg-[var(--panel-bg)] px-4 pt-[max(0.625rem,env(safe-area-inset-top))] pb-2.5 shadow-lg"
    >
      <div className="mx-auto flex max-w-3xl items-center gap-3 text-sm">
        <span
          aria-hidden="true"
          className={
            down
              ? 'h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--danger)] motion-safe:animate-[health-pulse_2s_ease-in-out_infinite]'
              : 'h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--accent)]'
          }
        />
        <span className="min-w-0 flex-1">
          <span className="font-semibold">{headline(down ? state.kind : 'recovered')}</span>{' '}
          <span className="text-[var(--muted)]">{detail(down ? state.kind : 'recovered')}</span>
        </span>
        {state.kind === 'offline' ? (
          <Pressable
            type="button"
            data-testid="connection-retry"
            onClick={healthMonitor.checkNow}
            className="shrink-0 rounded-md border border-[var(--border)] px-2.5 py-1 text-xs font-semibold hover:bg-[var(--hover-overlay)]"
          >
            {t('connection.retry')}
          </Pressable>
        ) : null}
      </div>
    </div>
  );
}

type Shown = 'offline' | 'device-offline' | 'recovered';

function headline(shown: Shown): string {
  if (shown === 'offline') return t('connection.serverOffline');
  if (shown === 'device-offline') return t('connection.deviceOffline');
  return t('connection.back');
}

function detail(shown: Shown): string {
  if (shown === 'offline') return t('connection.serverOfflineDetail');
  if (shown === 'device-offline') return t('connection.deviceOfflineDetail');
  return '';
}
