import { create } from 'zustand';

/**
 * Whether execution details render at all: reasoning, ordinary tools, and
 * subagents are presented as one thinking surface. This is a device property,
 * like theme and font size: localStorage only. Default on -- hiding is opt-in.
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
