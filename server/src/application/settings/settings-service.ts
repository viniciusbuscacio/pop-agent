import type { SettingsRepo } from '../ports/settings-repo.js';
import { DEFAULT_MODEL_ID } from '../providers/openrouter.js';
import { DEFAULT_PROVIDER_ID } from '../providers/provider-definitions.js';

/**
 * Application-owned settings (docs/specs/Spec-Pop-General.md §13). Deliberately not the wire DTO:
 * the interface layer maps between the two, so a rename here never silently
 * changes the API.
 *
 * Theme is absent on purpose -- it belongs to the device, not the account, and
 * lives in the browser's localStorage.
 */
export type PiUpdatePolicy = 'keep-current' | 'recommended' | 'latest';

export interface AppSettings {
  language: 'en';
  /** Provider used when a chat does not choose its own (docs/specs/Spec-Pop-General.md §15). */
  defaultProvider: string;
  /** Model used when a chat does not choose its own. */
  defaultModel: string;
  /** Appended to the agent's system prompt. Empty means none. */
  customInstructions: string;
  /** whisper.cpp model for voice transcription (docs/specs/Spec-Pop-General.md §14). */
  voiceModel: string;
  /** Whether an LLM pass improves the raw transcript. Off = raw text, fast. */
  voiceCleanup: boolean;
  /** Model for that pass; empty means the service model. */
  voiceCleanupModel: string;
  /** Whether background learning may create or update Auto-Skills (§8). */
  autoSkillsEnabled: boolean;
  /** Which pi release channel Pop Agent may evaluate (§15). Activation ships later. */
  piUpdatePolicy: PiUpdatePolicy;
}

export const DEFAULT_SETTINGS: AppSettings = {
  language: 'en',
  defaultProvider: DEFAULT_PROVIDER_ID,
  defaultModel: DEFAULT_MODEL_ID,
  customInstructions: '',
  voiceModel: 'base',
  voiceCleanup: false,
  voiceCleanupModel: '',
  autoSkillsEnabled: true,
  piUpdatePolicy: 'recommended',
};

const SETTINGS_KEY = 'app';

interface LegacySkillSettings {
  autoSkillMode?: 'disabled' | 'medium' | 'full';
  autoApproveSkills?: boolean;
  distillSkills?: boolean;
  distillIntervalMinutes?: number;
  autoActivatePreparedUpdates?: boolean;
  autoRestartIdleMinutes?: number;
}

function migratedAutoSkillsEnabled(settings: LegacySkillSettings): boolean {
  if (settings.autoSkillMode !== undefined) return settings.autoSkillMode !== 'disabled';
  if (settings.distillSkills !== undefined) return settings.distillSkills;
  return DEFAULT_SETTINGS.autoSkillsEnabled;
}

function withoutLegacyFields(
  settings: Partial<AppSettings> & LegacySkillSettings,
): Partial<AppSettings> {
  const current = { ...settings } as Record<string, unknown>;
  delete current.autoSkillMode;
  delete current.autoApproveSkills;
  delete current.distillSkills;
  delete current.distillIntervalMinutes;
  delete current.autoActivatePreparedUpdates;
  delete current.autoRestartIdleMinutes;
  return current as Partial<AppSettings>;
}

export class SettingsService {
  constructor(private readonly repo: SettingsRepo) {}

  read(): AppSettings {
    // Spread over the defaults: a document saved before a field existed still
    // answers with every field. Every formerly enabled mode maps to enabled;
    // only the old disabled state remains disabled.
    const stored = this.repo.get<Partial<AppSettings> & LegacySkillSettings>(SETTINGS_KEY);
    if (stored === undefined) return DEFAULT_SETTINGS;

    const autoSkillsEnabled =
      typeof stored.autoSkillsEnabled === 'boolean'
        ? stored.autoSkillsEnabled
        : migratedAutoSkillsEnabled(stored);
    return { ...DEFAULT_SETTINGS, ...withoutLegacyFields(stored), autoSkillsEnabled };
  }

  /** Full replace: callers send the whole object, so there is no merge to reason about. */
  write(next: AppSettings): AppSettings {
    this.repo.set(SETTINGS_KEY, next);
    return next;
  }

  /** Internal atomic-looking merge for independent Settings controls. */
  update(patch: Partial<AppSettings>): AppSettings {
    return this.write({ ...this.read(), ...patch });
  }
}
