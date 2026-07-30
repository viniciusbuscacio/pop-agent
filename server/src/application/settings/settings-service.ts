import type { SettingsRepo } from '../ports/settings-repo.js';

/**
 * Application-owned settings (popy.spec §13). Deliberately not the wire DTO:
 * the interface layer maps between the two, so a rename here never silently
 * changes the API.
 *
 * Theme is absent on purpose -- it belongs to the device, not the account, and
 * lives in the browser's localStorage.
 */
export interface AppSettings {
  language: 'en';
}

export const DEFAULT_SETTINGS: AppSettings = { language: 'en' };

const SETTINGS_KEY = 'app';

export class SettingsService {
  constructor(private readonly repo: SettingsRepo) {}

  read(): AppSettings {
    return this.repo.get<AppSettings>(SETTINGS_KEY) ?? DEFAULT_SETTINGS;
  }

  /** Full replace: callers send the whole object, so there is no merge to reason about. */
  write(next: AppSettings): AppSettings {
    this.repo.set(SETTINGS_KEY, next);
    return next;
  }
}
