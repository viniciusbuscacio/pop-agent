import { create } from 'zustand';

/**
 * Theme is a property of the device, not of the account (pop-agent.spec §14): it
 * never travels to the server, so the phone can be dark while the desktop is
 * light. The same value is read by the inline script in index.html before the
 * first paint.
 */

export type ThemeChoice = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'pop-agent.theme';

function storedChoice(): ThemeChoice {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
  } catch {
    return 'system';
  }
}

function prefersLight(): boolean {
  return typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: light)').matches
    : false;
}

export function applyTheme(choice: ThemeChoice): void {
  const dark = choice === 'dark' || (choice === 'system' && !prefersLight());
  document.documentElement.dataset['theme'] = dark ? 'dark' : 'light';
}

interface ThemeState {
  choice: ThemeChoice;
  setChoice: (choice: ThemeChoice) => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  choice: storedChoice(),
  setChoice: (choice) => {
    try {
      localStorage.setItem(STORAGE_KEY, choice);
    } catch {
      // A device that refuses storage still gets the theme for this session.
    }
    applyTheme(choice);
    set({ choice });
  },
}));
