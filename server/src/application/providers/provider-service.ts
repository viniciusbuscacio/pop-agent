import type { ModelInfo } from '../ports/agent-bridge.js';
import type { Clock } from '../ports/clock.js';
import type { CompletionRequest, ProviderGateway } from '../ports/provider-gateway.js';
import type { SecretsRepo } from '../ports/secrets-repo.js';
import type { SettingsRepo } from '../ports/settings-repo.js';
import {
  DEFAULT_PROVIDER_ID,
  PROVIDER_DEFINITIONS,
  keySecretName,
  providerDefinition,
  type ProviderDefinition,
} from './provider-definitions.js';

/**
 * The providers as the rest of the app sees them (popy.spec §15): where the
 * keys live, whether they work, and what models they offer. Provider is data,
 * not a class -- everything here is driven by PROVIDER_DEFINITIONS.
 *
 * A key is looked up in two places, in order: the secrets table (set from
 * Settings, sealed at rest) and then the environment (OpenRouter only, the
 * historical seed). A stored key beating the environment is deliberate -- it
 * is the one the user can see and change from the UI.
 */

const CATALOG_TTL_MS = 24 * 60 * 60 * 1000;
const CUSTOM_CONFIG_KEY = 'provider.custom.config';

/** What the key test sends. Short on purpose: it spends real money. */
const TEST_PROMPT = 'Reply with exactly: ok';
const TEST_MAX_TOKENS = 5;

export interface ProviderStatus {
  id: string;
  name: string;
  configured: boolean;
  source: 'settings' | 'env' | null;
  defaultModel: string;
  allowCustomModel: boolean;
  /** The custom provider's endpoint; never a secret. Absent for builtins. */
  baseURL?: string;
}

/** Where a catalog answer came from, freshest first. */
export type ModelCatalogSource = 'live' | 'cache' | 'engine' | 'static';

interface CatalogCache {
  fetchedAt: number;
  models: ModelInfo[];
}

/** The pair that identifies a model (popy.spec §15). */
export interface ModelRef {
  providerId: string;
  modelId: string;
}

/** The custom provider's user-supplied endpoint and model. */
export interface CustomProviderConfig {
  baseURL: string;
  defaultModel: string;
}

export interface ProviderServiceDeps {
  secrets: SecretsRepo;
  settings: SettingsRepo;
  /** The plain-HTTP face of each provider, by id. */
  gateways: Record<string, ProviderGateway>;
  clock: Clock;
  /** The environment's OpenRouter seed key, read late. */
  envKey: () => string | undefined;
  /**
   * The engine's own offline catalog (pi ships one) for a provider, consulted
   * when there is no key to fetch a live catalog with. Never the network.
   */
  engineModels: (providerId: string) => Promise<ModelInfo[]>;
  /** The global default pair from Settings. Read late; it is a setting. */
  defaults: () => { provider: string; model: string };
}

export class ProviderService {
  constructor(private readonly deps: ProviderServiceDeps) {}

  /** The key every consumer should use: stored beats environment. */
  apiKey(providerId: string): string | undefined {
    const stored = this.deps.secrets.get(keySecretName(providerId));
    if (stored !== undefined && stored.length > 0) return stored;
    if (providerId === DEFAULT_PROVIDER_ID) {
      const env = this.deps.envKey();
      if (env !== undefined && env.length > 0) return env;
    }
    return undefined;
  }

  status(providerId: string): ProviderStatus | undefined {
    const definition = providerDefinition(providerId);
    if (definition === undefined) return undefined;
    const key = this.deps.secrets.get(keySecretName(providerId));
    const stored = key !== undefined && key.length > 0;
    const env = providerId === DEFAULT_PROVIDER_ID ? this.deps.envKey() : undefined;
    const fromEnv = !stored && env !== undefined && env.length > 0;
    const custom = definition.customBaseURL ? this.customConfig() : undefined;
    return {
      id: definition.id,
      name: definition.name,
      configured: stored || fromEnv,
      source: stored ? 'settings' : fromEnv ? 'env' : null,
      defaultModel: custom?.defaultModel ?? this.storedDefaultModel(definition.id) ?? definition.defaultModel,
      allowCustomModel: definition.allowCustomModel,
      ...(custom === undefined ? {} : { baseURL: custom.baseURL }),
    };
  }

  statuses(): ProviderStatus[] {
    return PROVIDER_DEFINITIONS.map((definition) => {
      const status = this.status(definition.id);
      if (status === undefined) throw new Error(`missing definition: ${definition.id}`);
      return status;
    });
  }

  setKey(providerId: string, apiKey: string): void {
    this.deps.secrets.set(keySecretName(providerId), apiKey);
  }

  clearKey(providerId: string): void {
    this.deps.secrets.delete(keySecretName(providerId));
  }

  /** Whether the provider the next run would use has a key (health probe). */
  activeConfigured(): boolean {
    return this.status(this.resolve().providerId)?.configured ?? false;
  }

  /** The custom provider's endpoint, if the user filled one in. */
  customConfig(): CustomProviderConfig | undefined {
    const config = this.deps.settings.get<CustomProviderConfig>(CUSTOM_CONFIG_KEY);
    if (config === undefined || config.baseURL.length === 0) return undefined;
    return config;
  }

  setCustomConfig(config: CustomProviderConfig): void {
    this.deps.settings.set(CUSTOM_CONFIG_KEY, config);
  }

  /** The provider's default model, user-chosen or the definition's. */
  setDefaultModel(providerId: string, model: string): void {
    const definition = providerDefinition(providerId);
    if (definition === undefined) return;
    if (definition.customBaseURL) {
      const config = this.customConfig();
      this.setCustomConfig({ baseURL: config?.baseURL ?? '', defaultModel: model });
      return;
    }
    // Empty means "back to the definition's default" (no delete on the repo).
    this.deps.settings.set(`provider.${providerId}.defaultModel`, model);
  }

  private storedDefaultModel(providerId: string): string | undefined {
    const stored = this.deps.settings.get<string>(`provider.${providerId}.defaultModel`);
    return stored !== undefined && stored.length > 0 ? stored : undefined;
  }

  /**
   * Which pair should actually run (popy.spec §15): a chat override wins when
   * it is usable; otherwise the global default; when the default's key is
   * gone the next configured provider is elected -- the slot is never empty.
   * With nothing configured at all the default pair is answered anyway, and
   * the engine's error points the user to Settings.
   */
  resolve(override?: { provider?: string; model?: string }): ModelRef {
    const candidates: ModelRef[] = [];
    if (override !== undefined && override.provider !== undefined && override.provider.length > 0) {
      candidates.push(this.ref(override.provider, override.model));
    }
    const defaults = this.deps.defaults();
    candidates.push(this.ref(defaults.provider, defaults.model));
    for (const definition of PROVIDER_DEFINITIONS) {
      candidates.push(this.ref(definition.id, ''));
    }

    for (const candidate of candidates) {
      if (this.apiKey(candidate.providerId) !== undefined) return candidate;
    }
    return candidates[candidates.length > 1 ? 1 : 0] ?? this.ref(DEFAULT_PROVIDER_ID, '');
  }

  private ref(providerId: string, modelId: string | undefined): ModelRef {
    const definition = providerDefinition(providerId);
    const configured = this.status(providerId)?.defaultModel ?? '';
    const fallback = definition?.defaultModel ?? '';
    return {
      providerId,
      modelId:
        modelId !== undefined && modelId.length > 0 ? modelId : configured || fallback,
    };
  }

  /**
   * A real, paid-for round trip with the candidate key -- the only proof a
   * key works that does not involve waiting for a chat to fail. Costs a few
   * tokens by design (aw's Test button, ported), and reports how long the
   * provider took to answer. Saving never runs this; activating does.
   */
  async test(
    providerId: string,
    apiKey?: string,
  ): Promise<{ ok: boolean; message?: string; latencyMs?: number }> {
    const gateway = this.deps.gateways[providerId];
    const definition = providerDefinition(providerId);
    if (gateway === undefined || definition === undefined) {
      return { ok: false, message: `Unknown provider "${providerId}".` };
    }
    const key = apiKey ?? this.apiKey(providerId);
    if (key === undefined || key.length === 0) {
      return { ok: false, message: 'No API key to test.' };
    }
    const model = this.ref(providerId, '').modelId;
    if (model.length === 0) {
      return { ok: false, message: 'Choose a default model before testing.' };
    }

    const started = this.deps.clock.now();
    try {
      const request: CompletionRequest = {
        apiKey: key,
        model,
        prompt: TEST_PROMPT,
        maxTokens: TEST_MAX_TOKENS,
      };
      await gateway.complete(request);
      return { ok: true, latencyMs: this.deps.clock.now() - started };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'The test failed.',
        latencyMs: this.deps.clock.now() - started,
      };
    }
  }

  /**
   * The catalog, freshest first: live when there is a key, then the last
   * good fetch (24 h), then the engine's offline list, then the static one
   * from the definition. `source` says which layer answered, so the picker is
   * never empty and never pretends to be fresher than it is. CI and the
   * smoke run keyless, so they never touch the network here.
   */
  async models(providerId: string): Promise<{ models: ModelInfo[]; source: ModelCatalogSource }> {
    const definition = providerDefinition(providerId);
    if (definition === undefined) return { models: [], source: 'static' };
    const cacheKey = `models.${providerId}`;
    const gateway = this.deps.gateways[providerId];

    const key = this.apiKey(providerId);
    if (key !== undefined && gateway !== undefined) {
      const cached = this.deps.settings.get<CatalogCache>(cacheKey);
      if (cached !== undefined && this.deps.clock.now() - cached.fetchedAt < CATALOG_TTL_MS) {
        return { models: cached.models, source: 'cache' };
      }
      try {
        const models = await gateway.listModels(key);
        if (models.length > 0) {
          this.deps.settings.set<CatalogCache>(cacheKey, {
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
      const models = await this.deps.engineModels(providerId);
      if (models.length > 0) return { models, source: 'engine' };
    } catch {
      // The engine failing to list models must not take the catalog down.
    }
    const staticModels = this.staticFor(definition);
    return { models: staticModels, source: 'static' };
  }

  /** The custom provider's static catalog is its configured model. */
  private staticFor(definition: ProviderDefinition): ModelInfo[] {
    if (!definition.customBaseURL) return [...definition.staticModels];
    const config = this.customConfig();
    if (config === undefined || config.defaultModel.length === 0) return [];
    return [{ id: config.defaultModel, name: config.defaultModel }];
  }
}
