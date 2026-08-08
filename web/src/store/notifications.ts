import { create } from 'zustand';

/**
 * In-app notifications (pop-agent.spec §14) -- the small "this just happened"
 * messages the app shows itself, nothing to do with the operating system's
 * notifications. The update prompt set the shape; this is the general channel,
 * and the thinking toggle is its first caller.
 *
 * One slot on purpose: a new notice replaces the last, so flipping a toggle
 * back and forth updates the same pill instead of stacking a queue.
 */
export interface AppToast {
  id: number;
  message: string;
}

interface NotificationsState {
  toast: AppToast | undefined;
  notify: (message: string) => void;
  dismiss: () => void;
}

let nextId = 1;
const VISIBLE_MS = 2500;

export const useNotificationsStore = create<NotificationsState>((set) => ({
  toast: undefined,
  notify: (message) => {
    const id = nextId++;
    set({ toast: { id, message } });
    // Clears itself, unless a newer notice already took the slot.
    setTimeout(() => {
      set((state) => (state.toast?.id === id ? { toast: undefined } : state));
    }, VISIBLE_MS);
  },
  dismiss: () => set({ toast: undefined }),
}));
