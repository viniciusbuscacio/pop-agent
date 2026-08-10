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
    const next = {
      language: 'en' as const,
      defaultModel: 'openai/gpt-5',
      customInstructions: 'Answer in Portuguese.',
      defaultProvider: 'openrouter',
      voiceModel: 'small',
      voiceCleanup: true,
      voiceCleanupModel: 'openai/gpt-5-mini',
      autoSkillMode: 'full' as const,
      distillIntervalMinutes: 30,
      autoActivatePreparedUpdates: true,
      autoRestartIdleMinutes: 15,
    };

    expect(service.write(next)).toEqual(next);
    expect(service.read()).toEqual(next);
  });

  it('fills fields a document saved before they existed', () => {
    // The store may hold a document from an older Pop Agent; reading it must not
    // lose the fields that were invented since.
    const repo = new MemorySettings();
    repo.set('app', { language: 'en' });

    expect(new SettingsService(repo).read()).toEqual(DEFAULT_SETTINGS);
  });

  it('maps the two legacy booleans onto the three modes without changing policy', () => {
    const disabled = new MemorySettings();
    disabled.set('app', { distillSkills: false, autoApproveSkills: true });
    expect(new SettingsService(disabled).read().autoSkillMode).toBe('disabled');

    const medium = new MemorySettings();
    medium.set('app', { distillSkills: true, autoApproveSkills: false });
    expect(new SettingsService(medium).read().autoSkillMode).toBe('medium');

    const full = new MemorySettings();
    full.set('app', { distillSkills: true, autoApproveSkills: true });
    expect(new SettingsService(full).read().autoSkillMode).toBe('full');
  });
});
