import type { AutoSkillMode } from '../../domain/skills/auto-skill-policy.js';
import type { SettingsRepo } from '../ports/settings-repo.js';
import { DEFAULT_MODEL_ID } from '../providers/openrouter.js';
import { DEFAULT_PROVIDER_ID } from '../providers/provider-definitions.js';

/**
 * Application-owned settings (pop-agent.spec §13). Deliberately not the wire DTO:
 * the interface layer maps between the two, so a rename here never silently
 * changes the API.
 *
 * Theme is absent on purpose -- it belongs to the device, not the account, and
 * lives in the browser's localStorage.
 */
export interface AppSettings {
  language: 'en';
  /** Provider used when a chat does not choose its own (pop-agent.spec §15). */
  defaultProvider: string;
  /** Model used when a chat does not choose its own. */
  defaultModel: string;
  /** Appended to the agent's system prompt. Empty means none. */
  customInstructions: string;
  /** whisper.cpp model for voice transcription (pop-agent.spec §14). */
  voiceModel: string;
  /** Whether an LLM pass improves the raw transcript. Off = raw text, fast. */
  voiceCleanup: boolean;
  /** Model for that pass; empty means the service model. */
  voiceCleanupModel: string;
  /** Background learning and how far a baseline-safe candidate may go (§8). */
  autoSkillMode: AutoSkillMode;
  /**
   * Minutes between its ticks. One conversation per tick is the cost ceiling,
   * so this is the dial that sets it. Ten while the feature is new; the
   * intended factory setting once it has been watched for a while is thirty.
   */
  distillIntervalMinutes: number;
  /** Activate a gate-verified committed checkout once conversations and tasks are idle. */
  autoActivatePreparedUpdates: boolean;
  /** Quiet period required before an automatic activation may begin. */
  autoRestartIdleMinutes: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  language: 'en',
  defaultProvider: DEFAULT_PROVIDER_ID,
  defaultModel: DEFAULT_MODEL_ID,
  customInstructions: '',
  voiceModel: 'base',
  voiceCleanup: false,
  voiceCleanupModel: '',
  autoSkillMode: 'disabled',
  distillIntervalMinutes: 10,
  autoActivatePreparedUpdates: false,
  autoRestartIdleMinutes: 10,
};

const SETTINGS_KEY = 'app';

interface LegacySkillSettings {
  autoApproveSkills?: boolean;
  distillSkills?: boolean;
}

function isAutoSkillMode(value: unknown): value is AutoSkillMode {
  return value === 'disabled' || value === 'medium' || value === 'full';
}

function legacyAutoSkillMode(settings: LegacySkillSettings): AutoSkillMode {
  if (settings.distillSkills !== true) return 'disabled';
  return settings.autoApproveSkills === true ? 'full' : 'medium';
}

function withoutLegacyFields(
  settings: Partial<AppSettings> & LegacySkillSettings,
): Partial<AppSettings> {
  const current = { ...settings } as Record<string, unknown>;
  delete current.autoApproveSkills;
  delete current.distillSkills;
  return current as Partial<AppSettings>;
}

export class SettingsService {
  constructor(private readonly repo: SettingsRepo) {}

  read(): AppSettings {
    // Spread over the defaults: a document saved before a field existed still
    // answers with every field. The two legacy booleans map losslessly onto the
    // three modes, so upgrading never changes an existing owner's policy.
    const stored = this.repo.get<Partial<AppSettings> & LegacySkillSettings>(SETTINGS_KEY);
    if (stored === undefined) return DEFAULT_SETTINGS;

    const autoSkillMode = isAutoSkillMode(stored.autoSkillMode)
      ? stored.autoSkillMode
      : legacyAutoSkillMode(stored);
    return { ...DEFAULT_SETTINGS, ...withoutLegacyFields(stored), autoSkillMode };
  }

  /** Full replace: callers send the whole object, so there is no merge to reason about. */
  write(next: AppSettings): AppSettings {
    this.repo.set(SETTINGS_KEY, next);
    return next;
  }

  /** Internal atomic-looking merge for background policy changes such as rollback disabling auto activation. */
  update(patch: Partial<AppSettings>): AppSettings {
    return this.write({ ...this.read(), ...patch });
  }
}
