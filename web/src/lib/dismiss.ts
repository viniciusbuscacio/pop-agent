import { useEffect } from 'react';

/**
 * Closes a popup when the user clicks anywhere else or presses Escape.
 * The popup (and its toggle) must stop pointerdown propagation, so a click
 * inside never counts as "outside".
 */
export function useDismiss(open: boolean, close: () => void): void {
  useEffect(() => {
    if (!open) return;
    const onDown = (): void => close();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);
}
