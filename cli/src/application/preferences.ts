/** Device-local CLI presentation preferences. They never leave this machine. */
export interface CliPreferences {
  showThinking: boolean;
}

export interface PreferenceStore {
  read(): Partial<CliPreferences>;
  write(preferences: CliPreferences): void;
}

const DEFAULTS: CliPreferences = { showThinking: true };

/**
 * Small typed boundary around the preferences file.
 *
 * Thinking is visible by default, matching the web client. A missing or old
 * file therefore gains the current default without a migration.
 */
export class Preferences {
  constructor(private readonly store: PreferenceStore) {}

  get showThinking(): boolean {
    return this.store.read().showThinking ?? DEFAULTS.showThinking;
  }

  setShowThinking(showThinking: boolean): void {
    this.store.write({ ...DEFAULTS, ...this.store.read(), showThinking });
  }
}
