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
  /**
   * Whether a skill Pop Agent distils from a conversation goes straight into the
   * router (pop-agent.spec §8). Off -- the factory default -- means it is saved but
   * held until the user accepts it on the Skills screen. Named for the ON
   * state so that "off" reads as the cautious one it is: this flag is the
   * declared mitigation against a prompt injection earning a permanent place
   * in future prompts.
   */
  autoApproveSkills: boolean;
  /**
   * Whether the background distiller reads finished conversations at all
   * (pop-agent.spec §8, fase c). On by default: a tick with nothing idle and unread
   * makes no provider call, so the cost follows use and vanishes with it.
   */
  distillSkills: boolean;
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
  autoApproveSkills: false,
  distillSkills: true,
  distillIntervalMinutes: 10,
  autoActivatePreparedUpdates: false,
  autoRestartIdleMinutes: 10,
};

const SETTINGS_KEY = 'app';

export class SettingsService {
  constructor(private readonly repo: SettingsRepo) {}

  read(): AppSettings {
    // Spread over the defaults: a document saved before a field existed still
    // answers with every field.
    return { ...DEFAULT_SETTINGS, ...this.repo.get<Partial<AppSettings>>(SETTINGS_KEY) };
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
