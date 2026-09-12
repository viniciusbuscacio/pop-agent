import { create } from 'zustand';
import { session } from '../services/session';

/**
 * What the router needs to decide which screen to show: whether the server has
 * an account yet, and whether this device holds a session.
 */
export type AuthStatus = 'loading' | 'needs-setup' | 'signed-out' | 'signed-in';

interface AuthState {
  status: AuthStatus;
  setStatus: (status: AuthStatus) => void;
  signIn: (token: string, keepSignedIn: boolean) => void;
  signOut: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  status: 'loading',
  setStatus: (status) => set({ status }),
  signIn: (token, keepSignedIn) => {
    session.start(token, keepSignedIn);
    set({ status: 'signed-in' });
  },
  signOut: () => {
    session.clear();
    set({ status: 'signed-out' });
  },
}));
