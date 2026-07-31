import type { ModelInfo } from '../ports/agent-bridge.js';
import type { Clock } from '../ports/clock.js';
import type { CompletionRequest, ProviderGateway } from '../ports/provider-gateway.js';
import type { SecretsRepo } from '../ports/secrets-repo.js';
import type { SettingsRepo } from '../ports/settings-repo.js';
import {
  DEFAULT_MODEL_ID,
  FALLBACK_MODELS,
  OPENROUTER_PROVIDER_ID,
  TRANSCRIBE_MODEL_ID,
} from './openrouter.js';

/**
 * The OpenRouter provider as the rest of the app sees it (popy.spec §15):
 * where the key lives, whether it works, and what models it offers.
 *
 * The key is looked up in two places, in order: the secrets table (set from
 * Settings, sealed at rest) and then the environment. A stored key beating
 * the environment is deliberate -- it is the one the user can see and change
 * from the UI.
 */

const KEY_SECRET = 'provider.openrouter.apiKey';
const CATALOG_CACHE_KEY = 'models.openrouter';
const CATALOG_TTL_MS = 24 * 60 * 60 * 1000;

/** What the key test sends. Short on purpose: it spends real money. */
const TEST_PROMPT = 'Reply with exactly: ok';
const TEST_MAX_TOKENS = 5;

export interface ProviderStatus {
  id: string;
  configured: boolean;
  source: 'settings' | 'env' | null;
}

/** Where a catalog answer came from, freshest first. */
export type ModelCatalogSource = 'live' | 'cache' | 'engine' | 'static';

interface CatalogCache {
  fetchedAt: number;
  models: ModelInfo[];
}

export interface ProviderServiceDeps {
  secrets: SecretsRepo;
  settings: SettingsRepo;
  gateway: ProviderGateway;
  clock: Clock;
  /** The environment's key, read late so tests and Settings can change it. */
  envKey: () => string | undefined;
  /**
   * The engine's own offline catalog (pi ships one), consulted when there is
   * no key to fetch a live catalog with. Never the network.
   */
  engineModels: () => Promise<ModelInfo[]>;
}

export class ProviderService {
  constructor(private readonly deps: ProviderServiceDeps) {}

  /** The key every consumer should use: stored beats environment. */
  apiKey(): string | undefined {
    const stored = this.deps.secrets.get(KEY_SECRET);
    if (stored !== undefined && stored.length > 0) return stored;
    const env = this.deps.envKey();
    return env !== undefined && env.length > 0 ? env : undefined;
  }

  status(): ProviderStatus {
    const stored = this.deps.secrets.get(KEY_SECRET);
    if (stored !== undefined && stored.length > 0) {
      return { id: OPENROUTER_PROVIDER_ID, configured: true, source: 'settings' };
    }
    const env = this.deps.envKey();
    if (env !== undefined && env.length > 0) {
      return { id: OPENROUTER_PROVIDER_ID, configured: true, source: 'env' };
    }
    return { id: OPENROUTER_PROVIDER_ID, configured: false, source: null };
  }

  setKey(apiKey: string): void {
    this.deps.secrets.set(KEY_SECRET, apiKey);
  }

  clearKey(): void {
    this.deps.secrets.delete(KEY_SECRET);
  }

  /**
   * A real, paid-for round trip with the candidate key -- the only proof a
   * key works that does not involve waiting for a chat to fail. Costs a few
   * tokens by design (aw's Test button, ported), and reports how long the
   * provider took to answer.
   */
  async test(apiKey?: string): Promise<{ ok: boolean; message?: string; latencyMs?: number }> {
    const key = apiKey ?? this.apiKey();
    if (key === undefined || key.length === 0) {
      return { ok: false, message: 'No API key to test.' };
    }

    const request: CompletionRequest = {
      apiKey: key,
      model: DEFAULT_MODEL_ID,
      prompt: TEST_PROMPT,
      maxTokens: TEST_MAX_TOKENS,
    };
    const startedAt = this.deps.clock.now();
    try {
      await this.deps.gateway.complete(request);
      return { ok: true, latencyMs: this.deps.clock.now() - startedAt };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Request failed.',
        latencyMs: this.deps.clock.now() - startedAt,
      };
    }
  }

  /**
   * A voice note into words, through an audio-capable model (aw transcribes
   * locally with whisper.cpp; Popy uses the provider it already pays). The
   * answer IS the transcript; failures come back as words, not throws.
   */
  async transcribe(dataUri: string): Promise<{ ok: boolean; text?: string; message?: string }> {
    const key = this.apiKey();
    if (key === undefined) {
      return { ok: false, message: 'Configure a provider before using the microphone.' };
    }

    const match = /^data:audio\/([\w+-]+)(?:;[^,]*)?;base64,(.+)$/.exec(dataUri);
    if (match?.[1] === undefined || match[2] === undefined) {
      return { ok: false, message: 'The recording did not arrive as audio.' };
    }

    try {
      const text = await this.deps.gateway.transcribe({
        apiKey: key,
        model: TRANSCRIBE_MODEL_ID,
        audioBase64: match[2],
        // "mpeg" is how browsers spell mp3; providers spell it mp3.
        format: match[1] === 'mpeg' ? 'mp3' : match[1],
      });
      const trimmed = text.trim();
      if (trimmed.length === 0) return { ok: false, message: 'Nothing was heard.' };
      return { ok: true, text: trimmed };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Transcription failed.',
      };
    }
  }

  /**
   * The catalog, freshest source first: a live fetch when a key exists
   * (cached for a day), else the engine's offline catalog, else the pinned
   * row. Every answer says where it came from (aw's honest-source label), so
   * the picker is never empty and never pretends to be fresher than it is.
   * CI and the smoke run keyless, so they never touch the network here.
   */
  async models(): Promise<{ models: ModelInfo[]; source: ModelCatalogSource }> {
    const key = this.apiKey();
    if (key !== undefined) {
      const cached = this.deps.settings.get<CatalogCache>(CATALOG_CACHE_KEY);
      if (cached !== undefined && this.deps.clock.now() - cached.fetchedAt < CATALOG_TTL_MS) {
        return { models: cached.models, source: 'cache' };
      }
      try {
        const models = await this.deps.gateway.listModels(key);
        if (models.length > 0) {
          this.deps.settings.set<CatalogCache>(CATALOG_CACHE_KEY, {
            fetchedAt: this.deps.clock.now(),
            models,
          });
          return { models, source: 'live' };
        }
      } catch {
        // A stale cache is better than no catalog at all.
        if (cached !== undefined) return { models: cached.models, source: 'cache' };
      }
    }

    try {
      const models = await this.deps.engineModels();
      if (models.length > 0) return { models, source: 'engine' };
    } catch {
      // The engine failing to list models must not take the catalog down.
    }
    return { models: FALLBACK_MODELS, source: 'static' };
  }
}
