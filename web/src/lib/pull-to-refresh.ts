import { useEffect, useRef, useState, type RefObject } from 'react';

/**
 * Pull down at the top of a list to refresh it (popy.spec §14).
 *
 * An installed PWA has to build this itself. Safari's own pull-to-refresh
 * exists in a browser tab and NOT in standalone display mode, which is exactly
 * how Popy runs on the phone -- so the gesture every phone user already knows
 * is simply missing there unless we put it back.
 *
 * Chrome's model rather than iOS's: the list does not move, a spinner slides
 * down over it. Translating the scroller would fight the sticky headers and
 * the row menus that position against it, for a difference nobody asks for.
 *
 * The gesture is decided once and never taken back, the same rule the chat
 * rows' swipe already follows: mostly sideways belongs to the row (delete and
 * archive live there), anything upward belongs to the scroll. Only a downward
 * pull that starts at scrollTop 0 is ours -- and once it is ours we
 * preventDefault, which is also what stops iOS from rubber-banding the whole
 * app behind the list.
 */

/** How far the indicator must come down before letting go means anything. */
const TRIGGER_PX = 64;
const MAX_PX = 96;
/** The indicator follows half the finger: the pull should feel resisted. */
const RESISTANCE = 0.5;
/** A refresh that returns instantly still has to be seen to have happened. */
const MIN_SPIN_MS = 450;

export interface PullState {
  /** How far the indicator has come down, in px. */
  distance: number;
  /** A refresh is running: the spinner spins on its own. */
  refreshing: boolean;
  /** Far enough that letting go would refresh. */
  armed: boolean;
}

export function usePullToRefresh(
  scroller: RefObject<HTMLElement | null>,
  onRefresh: () => Promise<void>,
): PullState {
  const [distance, setDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  // The handler is attached once; it reads the newest callback through a ref
  // so a re-render does not tear the listeners down mid-gesture.
  const latest = useRef(onRefresh);
  latest.current = onRefresh;

  useEffect(() => {
    const element = scroller.current;
    if (element === null) return;

    let gesture: { startX: number; startY: number; armed: boolean } | null = null;
    let pulled = 0;
    let busy = false;
    let alive = true;

    const setPull = (value: number): void => {
      pulled = value;
      if (alive) setDistance(value);
    };

    const onStart = (event: TouchEvent): void => {
      // Two fingers is a pinch, and a list already scrolled is being scrolled.
      if (busy || event.touches.length !== 1 || element.scrollTop > 0) return;
      const touch = event.touches[0];
      if (touch === undefined) return;
      gesture = { startX: touch.clientX, startY: touch.clientY, armed: false };
    };

    const onMove = (event: TouchEvent): void => {
      if (gesture === null) return;
      const touch = event.touches[0];
      if (touch === undefined) return;
      const dy = touch.clientY - gesture.startY;
      const dx = touch.clientX - gesture.startX;

      if (!gesture.armed) {
        // Upward, or sideways, and the gesture was never ours to begin with.
        if (dy < 0 || Math.abs(dx) > 8) {
          gesture = null;
          return;
        }
        if (dy < 8) return;
        if (Math.abs(dx) >= dy) {
          gesture = null;
          return;
        }
        gesture.armed = true;
      }

      event.preventDefault();
      setPull(Math.min(dy * RESISTANCE, MAX_PX));
    };

    const run = async (): Promise<void> => {
      busy = true;
      if (alive) setRefreshing(true);
      const started = Date.now();
      try {
        await latest.current();
      } catch {
        // Whatever failed says so on its own screen; the spinner just ends.
      }
      const elapsed = Date.now() - started;
      if (elapsed < MIN_SPIN_MS) {
        await new Promise((resolve) => setTimeout(resolve, MIN_SPIN_MS - elapsed));
      }
      if (alive) setRefreshing(false);
      setPull(0);
      busy = false;
    };

    const onEnd = (): void => {
      const finished = gesture;
      gesture = null;
      if (finished === null || !finished.armed || pulled < TRIGGER_PX) {
        setPull(0);
        return;
      }
      // Hold the indicator at the trigger point while the work happens.
      setPull(TRIGGER_PX);
      void run();
    };

    // touchmove must be non-passive or preventDefault is ignored, which is the
    // whole mechanism; the others have nothing to cancel.
    element.addEventListener('touchstart', onStart, { passive: true });
    element.addEventListener('touchmove', onMove, { passive: false });
    element.addEventListener('touchend', onEnd, { passive: true });
    element.addEventListener('touchcancel', onEnd, { passive: true });

    return () => {
      alive = false;
      element.removeEventListener('touchstart', onStart);
      element.removeEventListener('touchmove', onMove);
      element.removeEventListener('touchend', onEnd);
      element.removeEventListener('touchcancel', onEnd);
    };
  }, [scroller]);

  return { distance, refreshing, armed: distance >= TRIGGER_PX };
}
