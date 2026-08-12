import { describe, expect, it } from 'vitest';
import { Preferences, type CliPreferences, type PreferenceStore } from './preferences.js';

class MemoryStore implements PreferenceStore {
  constructor(private value: Partial<CliPreferences> = {}) {}
  read(): Partial<CliPreferences> {
    return this.value;
  }
  write(preferences: CliPreferences): void {
    this.value = preferences;
  }
}

describe('CLI preferences', () => {
  it('shows reasoning by default and remembers an explicit choice', () => {
    const store = new MemoryStore();
    const preferences = new Preferences(store);

    expect(preferences.showThinking).toBe(true);
    preferences.setShowThinking(false);
    expect(new Preferences(store).showThinking).toBe(false);
  });
});
