import { useNotificationsStore } from '../store/notifications';
import { Pressable } from './controls';

/**
 * In-app notifications, in the same corner and skin as the update prompt
 * (docs/specs/Spec-Pop-General.md §14): the default way the app tells you something small happened
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
  const action = toast.action;

  return (
    <div
      className="fixed top-16 right-3 z-50 flex max-w-[calc(100vw-1.5rem)] items-center rounded-lg border border-[var(--notice-border)] bg-[var(--notice-bg)] text-sm shadow-lg"
      data-testid="toasts"
      role="status"
    >
      <Pressable
        type="button"
        data-testid="toast"
        onClick={dismiss}
        className="min-w-0 px-4 py-2 text-left"
      >
        {toast.message}
      </Pressable>
      {action === undefined ? null : (
        <Pressable
          type="button"
          data-testid="toast-action"
          className="shrink-0 px-4 py-2 font-medium text-[var(--accent)]"
          onClick={() => {
            dismiss();
            void action.run();
          }}
        >
          {action.label}
        </Pressable>
      )}
    </div>
  );
}
