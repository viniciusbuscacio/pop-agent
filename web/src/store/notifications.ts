import { create } from 'zustand';

/**
 * In-app notifications (docs/specs/Spec-Pop-General.md §14) -- the small "this just happened"
 * messages the app shows itself, nothing to do with the operating system's
 * notifications. The update prompt set the shape; this is the general channel,
 * and the thinking toggle is its first caller.
 *
 * One slot on purpose: a new notice replaces the last, so flipping a toggle
 * back and forth updates the same pill instead of stacking a queue.
 */
export interface ToastAction {
  label: string;
  run: () => void | Promise<void>;
}

export interface AppToast {
  id: number;
  message: string;
  action?: ToastAction;
}

interface NotificationsState {
  toast: AppToast | undefined;
  notify: (message: string, action?: ToastAction) => void;
  dismiss: () => void;
}

let nextId = 1;
const VISIBLE_MS = 2500;
const ACTION_VISIBLE_MS = 6000;

export const useNotificationsStore = create<NotificationsState>((set) => ({
  toast: undefined,
  notify: (message, action) => {
    const id = nextId++;
    set({ toast: action === undefined ? { id, message } : { id, message, action } });
    // Actionable notices stay long enough to read and reach on a phone.
    // Clears itself unless a newer notice already took the slot.
    setTimeout(() => {
      set((state) => (state.toast?.id === id ? { toast: undefined } : state));
    }, action === undefined ? VISIBLE_MS : ACTION_VISIBLE_MS);
  },
  dismiss: () => set({ toast: undefined }),
}));
