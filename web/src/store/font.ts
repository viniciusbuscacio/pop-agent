import { create } from 'zustand';

/**
 * Font size is a property of the device, not of the account (same contract as
 * the theme): it lives in localStorage and never reaches the server, so the
 * phone can run larger type than the desktop. Applied as a root font-size so
 * every rem in the app scales together.
 */

export type FontSizeChoice = 'small' | 'default' | 'large' | 'xlarge' | 'huge';

const STORAGE_KEY = 'popy.fontSize';

const SCALE: Record<FontSizeChoice, string> = {
  small: '87.5%',
  default: '100%',
  large: '112.5%',
  xlarge: '125%',
  huge: '140%',
};

function storedChoice(): FontSizeChoice {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    const valid: FontSizeChoice[] = ['small', 'default', 'large', 'xlarge', 'huge'];
    return valid.includes(value as FontSizeChoice) ? (value as FontSizeChoice) : 'default';
  } catch {
    return 'default';
  }
}

export function applyFontSize(choice: FontSizeChoice): void {
  document.documentElement.style.fontSize = SCALE[choice];
}

interface FontState {
  choice: FontSizeChoice;
  setChoice: (choice: FontSizeChoice) => void;
}

export const useFontStore = create<FontState>((set) => ({
  choice: storedChoice(),
  setChoice: (choice) => {
    try {
      localStorage.setItem(STORAGE_KEY, choice);
    } catch {
      // A device that refuses storage still gets the size for this session.
    }
    applyFontSize(choice);
    set({ choice });
  },
}));
