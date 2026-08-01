import type { SettingsRepo } from '../ports/settings-repo.js';
import { DEFAULT_MODEL_ID } from '../providers/openrouter.js';
import { DEFAULT_PROVIDER_ID } from '../providers/provider-definitions.js';

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
  /** Provider used when a chat does not choose its own (popy.spec §15). */
  defaultProvider: string;
  /** Model used when a chat does not choose its own. */
  defaultModel: string;
  /** Model for background jobs: titles, summaries (popy.spec §15). */
  serviceModel: string;
  /** Appended to the agent's system prompt. Empty means none. */
  customInstructions: string;
  /** whisper.cpp model for voice transcription (popy.spec §14). */
  voiceModel: string;
  /** Whether an LLM pass improves the raw transcript. Off = raw text, fast. */
  voiceCleanup: boolean;
  /** Model for that pass; empty means the service model. */
  voiceCleanupModel: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  language: 'en',
  defaultProvider: DEFAULT_PROVIDER_ID,
  defaultModel: DEFAULT_MODEL_ID,
  serviceModel: DEFAULT_MODEL_ID,
  customInstructions: '',
  voiceModel: 'base',
  voiceCleanup: false,
  voiceCleanupModel: '',
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
}
