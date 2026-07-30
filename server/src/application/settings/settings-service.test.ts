import { describe, expect, it } from 'vitest';
import type { SettingsRepo } from '../ports/settings-repo.js';
import { DEFAULT_SETTINGS, SettingsService } from './settings-service.js';

class MemorySettings implements SettingsRepo {
  private readonly rows = new Map<string, string>();
  get<T>(key: string): T | undefined {
    const raw = this.rows.get(key);
    return raw === undefined ? undefined : (JSON.parse(raw) as T);
  }
  set<T>(key: string, value: T): void {
    this.rows.set(key, JSON.stringify(value));
  }
}

describe('settings service', () => {
  it('answers with the defaults before anything was ever saved', () => {
    expect(new SettingsService(new MemorySettings()).read()).toEqual(DEFAULT_SETTINGS);
  });

  it('reads back what it wrote', () => {
    const service = new SettingsService(new MemorySettings());

    expect(service.write({ language: 'en' })).toEqual({ language: 'en' });
    expect(service.read()).toEqual({ language: 'en' });
  });
});
