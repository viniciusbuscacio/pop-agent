import { create } from 'zustand';

/**
 * Whether and how often this device asks its service worker for a new app
 * build. Both controls are device-scoped like the theme (pop-agent.spec §14,
 * §15): they never travel to the server. Automatic checks are on at ten minutes
 * by default while Pop Agent moves fast; the shipped default drops to daily.
 *
 * An installed PWA only re-checks its worker on navigation, which on a phone
 * can be days -- so without this timer a fix can sit unseen indefinitely.
 */

const STORAGE_KEY = 'pop-agent.updateCheckMinutes';
const ENABLED_STORAGE_KEY = 'pop-agent.updateChecksEnabled';

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

function storedEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_STORAGE_KEY) !== '0';
  } catch {
    return true;
  }
}

interface UpdatesState {
  enabled: boolean;
  intervalMinutes: number;
  setEnabled: (enabled: boolean) => void;
  setIntervalMinutes: (minutes: number) => void;
}

export const useUpdatesStore = create<UpdatesState>((set) => ({
  enabled: storedEnabled(),
  intervalMinutes: storedMinutes(),
  setEnabled: (enabled) => {
    try {
      localStorage.setItem(ENABLED_STORAGE_KEY, enabled ? '1' : '0');
    } catch {
      // A device that refuses storage still honours the choice this session.
    }
    set({ enabled });
  },
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
