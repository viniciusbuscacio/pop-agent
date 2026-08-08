import { create } from 'zustand';

/**
 * How often the installed PWA asks its service worker whether a new build is
 * out. Device-scoped like the theme (pop-agent.spec §14, §15): it never travels to
 * the server, so each device keeps its own schedule. Ten minutes by default
 * while Pop Agent moves fast; the shipped default drops to daily (pop-agent.spec §15).
 *
 * An installed PWA only re-checks its worker on navigation, which on a phone
 * can be days -- so without this timer a fix can sit unseen indefinitely.
 */

const STORAGE_KEY = 'pop-agent.updateCheckMinutes';

export const DEFAULT_UPDATE_MINUTES = 10;
export const UPDATE_INTERVAL_OPTIONS = [5, 10, 30, 60, 360, 1440] as const;

function isKnownOption(value: number): boolean {
  return UPDATE_INTERVAL_OPTIONS.some((option) => option === value);
}

function storedMinutes(): number {
  try {
    const raw = Number(localStorage.getItem(STORAGE_KEY));
    return isKnownOption(raw) ? raw : DEFAULT_UPDATE_MINUTES;
  } catch {
    return DEFAULT_UPDATE_MINUTES;
  }
}

interface UpdatesState {
  intervalMinutes: number;
  setIntervalMinutes: (minutes: number) => void;
}

export const useUpdatesStore = create<UpdatesState>((set) => ({
  intervalMinutes: storedMinutes(),
  setIntervalMinutes: (minutes) => {
    const next = isKnownOption(minutes) ? minutes : DEFAULT_UPDATE_MINUTES;
    try {
      localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // A device that refuses storage still honours the choice this session.
    }
    set({ intervalMinutes: next });
  },
}));
