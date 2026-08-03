import { useNotificationsStore } from '../store/notifications';

/**
 * In-app notifications, in the same corner and skin as the update prompt
 * (popy.spec §14): the default way the app tells you something small happened
 * -- the thinking toggle is the first. Tap to dismiss; it clears on its own
 * either way. Not the operating system's notifications, which are Web Push.
 *
 * Sits just below the update prompt's slot so the two never land on top of
 * each other on the rare turn both are up.
 */
export function Toasts() {
  const toast = useNotificationsStore((state) => state.toast);
  const dismiss = useNotificationsStore((state) => state.dismiss);

  if (toast === undefined) return null;

  return (
    <div className="fixed top-16 right-3 z-50 flex flex-col gap-2" data-testid="toasts">
      <button
        type="button"
        data-testid="toast"
        onClick={dismiss}
        className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-4 py-2 text-left text-sm shadow-lg"
      >
        {toast.message}
      </button>
    </div>
  );
}
