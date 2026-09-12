import { useRef, useCallback, type ReactNode } from 'react';
import { usePullToRefresh } from '../lib/pull-to-refresh';
import { checkForUpdate } from '../services/update-signal';

/**
 * A scroll area you can pull down to refresh (docs/specs/Spec-Pop-General.md §14). Wraps the list
 * it scrolls, so a screen adopts the gesture by swapping its own
 * `overflow-y-auto` div for this one.
 *
 * The spinner floats over the list instead of pushing it, Chrome's way -- see
 * lib/pull-to-refresh for why. Below the trigger point it is dim and turns
 * with the finger, so the gesture reports its own progress and letting go
 * early is visibly a no-op.
 */
export function PullToRefresh({
  onRefresh,
  className = '',
  testId,
  children,
}: {
  onRefresh: () => Promise<void>;
  className?: string;
  testId?: string;
  children: ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  /**
   * A pull means "give me the latest", and on a phone that includes the app
   * itself: an installed PWA only re-checks its worker on navigation, so a
   * shipped fix can sit unseen for days. The two run together and neither
   * waits on the other's failure -- a server that is down must not stop the
   * cached list from redrawing.
   */
  const refresh = useCallback(async (): Promise<void> => {
    await Promise.allSettled([onRefresh(), checkForUpdate()]);
  }, [onRefresh]);
  const { distance, refreshing, armed } = usePullToRefresh(scroller, refresh);
  const showing = distance > 0 || refreshing;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {showing ? (
        <div
          data-testid="pull-indicator"
          data-armed={armed ? 'true' : 'false'}
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center"
          style={{
            transform: `translateY(${String(Math.max(distance - 34, 0))}px)`,
            // Snapping back is animated; following the finger is not, or the
            // indicator would lag behind the pull.
            transition: refreshing || distance === 0 ? 'transform 180ms ease-out' : 'none',
            opacity: refreshing ? 1 : Math.min(distance / 64, 1),
          }}
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--panel-bg)] shadow-md">
            <span
              className={`h-4 w-4 rounded-full border-2 border-[var(--accent)] border-t-transparent ${
                refreshing ? 'motion-safe:animate-spin' : ''
              }`}
              style={refreshing ? undefined : { transform: `rotate(${String(distance * 3)}deg)` }}
            />
          </span>
        </div>
      ) : null}
      <div
        ref={scroller}
        data-testid={testId}
        // contain keeps the pull inside this list: without it iOS hands the
        // leftover movement to the page and bounces the whole app.
        className={`min-h-0 flex-1 overflow-y-auto overscroll-y-contain ${className}`}
      >
        {children}
      </div>
    </div>
  );
}
