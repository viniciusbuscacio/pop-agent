import { useSyncExternalStore } from 'react';

/**
 * Is the viewport at least this wide, right now? For the handful of decisions
 * a CSS breakpoint cannot make on its own -- how many items to *build*, not
 * how to paint the ones already built (the breadcrumb picks how many steps to
 * render, and rendering five and hiding two would still shrink them all).
 *
 * `md` here is Tailwind's 768px, the same line the layout switches on: one
 * number, so the two can never disagree.
 */
export const MD_BREAKPOINT = '(min-width: 768px)';

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      // No matchMedia in a server render or an old jsdom: subscribing to
      // nothing is correct there, and the snapshot below answers false.
      if (typeof window.matchMedia !== 'function') return () => undefined;
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => {
        list.removeEventListener('change', onChange);
      };
    },
    () => (typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false),
    () => false,
  );
}
