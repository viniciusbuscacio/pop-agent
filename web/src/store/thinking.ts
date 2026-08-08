import { create } from 'zustand';

/**
 * Whether thinking cards render at all. A property of the device, like the
 * theme and the font size: localStorage only, so the phone can hide the
 * reasoning the desktop shows. Default on -- hiding is the opt-in.
 */

const STORAGE_KEY = 'pop-agent.showThinking';

function storedShow(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

interface ThinkingState {
  show: boolean;
  toggle: () => void;
}

export const useThinkingStore = create<ThinkingState>((set, get) => ({
  show: storedShow(),
  toggle: () => {
    const show = !get().show;
    try {
      localStorage.setItem(STORAGE_KEY, String(show));
    } catch {
      // storage denied; the preference lasts this session only
    }
    set({ show });
  },
}));
