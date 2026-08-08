import { randomBytes } from 'node:crypto';
import type { ModelInfo } from '../ports/agent-bridge.js';
import type { Clock } from '../ports/clock.js';
import { ProviderGatewayError } from '../ports/provider-gateway.js';
import type { CompletionRequest, ProviderGateway } from '../ports/provider-gateway.js';
import type { SecretsRepo } from '../ports/secrets-repo.js';
import type { SettingsRepo } from '../ports/settings-repo.js';
import {
  DEFAULT_PROVIDER_ID,
  allProviderDefinitions,
  customProviderDefinition,
  keySecretName,
  normalizeCustomBaseUrl,
  providerDefinition,
  type CustomProviderInstance,
  type ProviderDefinition,
} from './provider-definitions.js';
import type { ProviderCooldown } from './provider-cooldown.js';

/**
 * The providers as the rest of the app sees them (pop-agent.spec §15): where the
 * keys live, whether they work, and what models they offer. Provider is data,
 * not a class -- everything here is driven by PROVIDER_DEFINITIONS.
 *
 * A key is looked up in two places, in order: the secrets table (set from
 * Settings, sealed at rest) and then the environment (OpenRouter only, the
 * historical seed). A stored key beating the environment is deliberate -- it
 * is the one the user can see and change from the UI.
 */

const CATALOG_TTL_MS = 24 * 60 * 60 * 1000;

/** The unlimited-customs registry (pop-agent.spec §15): pure data, never a key. */
const CUSTOM_REGISTRY_KEY = 'provider.custom.registry';
/** The single-slot era's config and id; read only by the boot migration. */
const LEGACY_CUSTOM_CONFIG_KEY = 'provider.custom.config';
const LEGACY_CUSTOM_ID = 'custom';
/** Where a chat override saying `custom` now points (set by the migration). */
const CUSTOM_ALIAS_KEY = 'provider.custom.alias';

/**
 * The priority list, #1 first (pop-agent.spec §15, fase 2). The list IS the
 * failover chain and its head IS the global default: one lever, so the
 * numbered list can never disagree with what a new chat actually uses.
 */
const ORDER_KEY = 'provider.order';
/** See {@link ProviderService.createCustom}. */
export const MAX_CUSTOM_PROVIDERS = 256;
/** The ids the user switched off. Off means out of the chain entirely. */
const DISABLED_KEY = 'provider.disabled';

/** What the key test sends. Short on purpose: it spends real money. */
const TEST_PROMPT = 'Reply with exactly: ok';
const TEST_MAX_TOKENS = 5;

export interface ProviderStatus {
  id: string;
  name: string;
  /** How the provider authenticates: a stored key, or pi's OAuth login. */
  authType: 'api-key' | 'oauth';
  configured: boolean;
  source: 'settings' | 'env' | 'oauth' | null;
  defaultModel: string;
  /**
   * The model this provider uses for Pop Agent's own background work -- titles,
   * summaries, transcript cleanup (pop-agent.spec §15). Equal to `defaultModel`
   * until the user picks something cheaper.
   */
  serviceModel: string;
  allowCustomModel: boolean;
  /** A custom instance's endpoint; never a secret. Absent for builtins. */
  baseURL?: string;
  /** True for a user-created custom instance: editable, deletable. */
  custom?: boolean;
  /** Position in the priority list, 1-based. #1 is the global default. */
  order: number;
  /** The user's on/off switch: a disabled provider never serves a run. */
  enabled: boolean;
  /** When set, the last run failed with an auth-class error (pop-agent.spec §15). */
  authErrorAt?: string;
}

/** Where a catalog answer came from, freshest first. */
export type ModelCatalogSource = 'live' | 'cache' | 'engine' | 'static';

interface CatalogCache {
  fetchedAt: number;
  models: ModelInfo[];
}

/** The pair that identifies a model (pop-agent.spec §15). */
export interface ModelRef {
  providerId: string;
  modelId: string;
}

/** The single-slot era's settings shape; read only by the boot migration. */
interface LegacyCustomConfig {
  baseURL: string;
  defaultModel: string;
}

export interface ProviderServiceDeps {
  secrets: SecretsRepo;
  settings: SettingsRepo;
  /** The plain-HTTP face of each BUILTIN provider, by id. */
  gateways: Record<string, ProviderGateway>;
  /**
   * Builds the gateway for a custom instance's endpoint (pop-agent.spec §15).
   * Called per use with the instance's normalized base URL.
   */
  customGateway?: (baseURL: string) => ProviderGateway;
  /**
   * Ten hex characters for a new custom id. Overridable so the collision
   * retry can be tested; production uses crypto randomness.
   */
  customIdSource?: () => string;
  clock: Clock;
  /** The environment's OpenRouter seed key, read late. */
  envKey: () => string | undefined;
  /**
   * The engine's own offline catalog (pi ships one) for a provider, consulted
   * when there is no key to fetch a live catalog with. Never the network.
   */
  engineModels: (providerId: string) => Promise<ModelInfo[]>;
  /**
   * Whether the engine holds an OAuth credential for a provider (pop-agent.spec
   * §15, fase 1.5). The credential lives in pi's own store; this is the only
   * question the service ever asks about it.
   */
  engineHasAuth: (providerId: string) => boolean;
  /**
   * One completion through the engine. The only completion path for a
   * subscription, and the one every provider without a usable gateway key
   * takes, so background work is not a feature api-key providers alone get.
   */
  engineComplete: (request: {
    providerId: string;
    modelId: string;
    prompt: string;
    maxTokens?: number;
  }) => Promise<string>;
  /** Drops the engine's stored OAuth credential (disconnect). */
  engineLogout: (providerId: string) => Promise<void>;
  /**
   * The advisory failover cooldown (pop-agent.spec §15, fase 2): the chain skips
   * penalized providers, and saving a key forgives its provider.
   */
  cooldown?: ProviderCooldown;
  /** The global default pair from Settings. Read late; it is a setting. */
  defaults: () => { provider: string; model: string };
  /**
   * Writes the elected head of the list back as the global default. Without
   * it the numbered list and the default drift apart, which is the bug aw
   * fixed by making activation and #1 the same lever.
   */
  setDefaultProvider?: (providerId: string, model: string) => void;
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
    const definition = this.definition(providerId);
    if (definition === undefined) return undefined;
    const authErrorAt = this.authErrorAt(definition.id);
    const authFields = authErrorAt === undefined ? {} : { authErrorAt };
    if (definition.authType === 'oauth') {
      // No key anywhere: configured means the engine holds a subscription
      // credential, obtained through its own login flow.
      const connected = this.deps.engineHasAuth(definition.id);
      return {
        id: definition.id,
        name: definition.name,
        authType: 'oauth',
        configured: connected,
        source: connected ? 'oauth' : null,
        defaultModel: this.storedDefaultModel(definition.id) ?? definition.defaultModel,
        serviceModel: this.serviceModel(definition.id),
        allowCustomModel: definition.allowCustomModel,
        order: this.positionOf(definition.id),
        enabled: this.isEnabled(definition.id),
        ...authFields,
      };
    }
    const key = this.deps.secrets.get(keySecretName(definition.id));
    const stored = key !== undefined && key.length > 0;
    const env = definition.id === DEFAULT_PROVIDER_ID ? this.deps.envKey() : undefined;
    const fromEnv = !stored && env !== undefined && env.length > 0;
    return {
      id: definition.id,
      name: definition.name,
      authType: 'api-key',
      configured: stored || fromEnv,
      source: stored ? 'settings' : fromEnv ? 'env' : null,
      // A custom instance's model lives in the registry (the definition);
      // a builtin's user-chosen default lives in settings.
      defaultModel: definition.customBaseURL
        ? definition.defaultModel
        : this.storedDefaultModel(definition.id) ?? definition.defaultModel,
      serviceModel: this.serviceModel(definition.id),
      allowCustomModel: definition.allowCustomModel,
      order: this.positionOf(definition.id),
      enabled: this.isEnabled(definition.id),
      ...(definition.customBaseURL ? { baseURL: definition.baseURL, custom: true } : {}),
      ...authFields,
    };
  }

  statuses(): ProviderStatus[] {
    return this.definitions().map((definition) => {
      const status = this.status(definition.id);
      if (status === undefined) throw new Error(`missing definition: ${definition.id}`);
      return status;
    });
  }

  setKey(providerId: string, apiKey: string): void {
    this.deps.secrets.set(keySecretName(providerId), apiKey);
    // New evidence: a freshly saved key deserves a first try immediately.
    this.deps.cooldown?.clear(providerId);
    this.clearAuthError(providerId);
    // A new key may be a new account with a different catalog.
    this.invalidateCatalogCache(providerId);
  }

  clearKey(providerId: string): void {
    this.deps.secrets.delete(keySecretName(providerId));
    this.electDefault();
  }

  /**
   * Records that a run failed with an auth-class error. The chat path calls
   * this when the provider refuses credentials; status surfaces the marker so
   * a revoked subscription is not reported as healthy forever.
   */
  noteAuthFailure(providerId: string): void {
    const id = this.canonicalId(providerId);
    this.deps.settings.set(
      `provider.${id}.authErrorAt`,
      new Date(this.deps.clock.now()).toISOString(),
    );
  }

  /** New evidence from a fresh sign-in: the auth-error marker is cleared. */
  noteOAuthSuccess(providerId: string): void {
    this.clearAuthError(providerId);
  }

  /** Drops an oauth provider's subscription credential (pop-agent.spec §15). */
  async disconnect(providerId: string): Promise<void> {
    if (providerDefinition(providerId)?.authType !== 'oauth') return;
    await this.deps.engineLogout(providerId);
  }

  /**
   * The priority list, #1 first: the stored ids that still exist, then every
   * remaining provider appended. The tail matters -- a provider added (or a
   * custom instance created) after the list was saved must still be reachable
   * instead of silently sitting outside the chain.
   */
  order(): string[] {
    const known = this.definitions().map((definition) => definition.id);
    const ordered: string[] = [];
    const stored = this.deps.settings.get<string[]>(ORDER_KEY);
    // Never edited: the install's existing global default is #1, so removing
    // the old separate default control cannot silently move anyone's answers
    // to another provider. From the first edit on, the list alone decides.
    const seed = stored ?? [this.canonicalId(this.deps.defaults().provider)];
    for (const id of seed) {
      const canonical = this.canonicalId(id);
      if (known.includes(canonical) && !ordered.includes(canonical)) ordered.push(canonical);
    }
    for (const id of known) {
      if (!ordered.includes(id)) ordered.push(id);
    }
    return ordered;
  }

  /**
   * Rewrites the priority list. Unknown ids are dropped rather than stored,
   * so a stale browser tab cannot resurrect a deleted custom instance, and
   * the head is elected as the new global default.
   */
  setOrder(ids: string[]): string[] {
    const known = new Set(this.definitions().map((definition) => definition.id));
    const cleaned: string[] = [];
    for (const id of ids) {
      const canonical = this.canonicalId(id);
      if (known.has(canonical) && !cleaned.includes(canonical)) cleaned.push(canonical);
    }
    this.deps.settings.set(ORDER_KEY, cleaned);
    this.electDefault();
    return this.order();
  }

  /** Whether the provider is switched on. Unknown ids read as on. */
  isEnabled(providerId: string): boolean {
    return !this.disabledIds().includes(this.canonicalId(providerId));
  }

  /**
   * Flips the on/off switch. Switching off the provider currently serving as
   * the default hands the default to the next usable one, so the slot is
   * never left pointing at something that cannot answer.
   */
  setEnabled(providerId: string, enabled: boolean): void {
    const canonical = this.canonicalId(providerId);
    const disabled = this.disabledIds().filter((id) => id !== canonical);
    if (!enabled) disabled.push(canonical);
    this.deps.settings.set(DISABLED_KEY, disabled);
    this.electDefault();
  }

  private disabledIds(): string[] {
    return this.deps.settings.get<string[]>(DISABLED_KEY) ?? [];
  }

  /** 1-based position in the list; every known provider has one. */
  private positionOf(providerId: string): number {
    return this.order().indexOf(this.canonicalId(providerId)) + 1;
  }

  /**
   * The first usable provider of the list becomes the global default. Called
   * after every edit to the list or the switches: it is what keeps "#1" and
   * "what a new chat uses" the same statement. With nothing usable the
   * current default is left alone -- an empty slot breaks more than a stale
   * one, and the run error already points at Settings.
   */
  private electDefault(): void {
    const write = this.deps.setDefaultProvider;
    if (write === undefined) return;
    for (const id of this.order()) {
      if (!this.usable(id)) continue;
      if (this.canonicalId(this.deps.defaults().provider) === id) return;
      write(id, this.ref(id, '').modelId);
      return;
    }
  }

  /** Whether the provider the next run would use has a key (health probe). */
  activeConfigured(): boolean {
    return this.status(this.resolve().providerId)?.configured ?? false;
  }

  /** The user-created custom instances, in registry (= chain) order. */
  listCustom(): CustomProviderInstance[] {
    return this.deps.settings.get<CustomProviderInstance[]>(CUSTOM_REGISTRY_KEY) ?? [];
  }

  /**
   * Creates a custom instance (pop-agent.spec §15): an id nothing else carries --
   * `custom-` + 5 random hex bytes, re-rolled on the unlikely collision --
   * and pure data beside it. The key arrives later through the ordinary
   * per-provider key route, sealed under this id.
   */
  createCustom(
    input: { name?: string; baseURL?: string; defaultModel?: string },
  ): CustomProviderInstance | undefined {
    const registry = this.listCustom();
    // How many can exist AT ONCE, never how many have ever existed: the
    // registry is the live list, so deleting one frees its place and an
    // install that adds and removes for years never creeps toward the ceiling
    // (Vinicius, 03/08). 256 is far past any real install and still stops a
    // runaway loop from writing thousands of rows into one settings value --
    // the priority list is a 1..N dropdown, and N has to stay a number a
    // person can hold.
    if (registry.length >= MAX_CUSTOM_PROVIDERS) return undefined;
    let id: string;
    do {
      id = `custom-${(this.deps.customIdSource ?? defaultCustomIdSource)()}`;
    } while (registry.some((instance) => instance.id === id));

    const instance: CustomProviderInstance = {
      id,
      name: input.name !== undefined && input.name.length > 0 ? input.name : 'Custom provider',
      baseURL: normalizeCustomBaseUrl(input.baseURL ?? ''),
      defaultModel: input.defaultModel ?? '',
    };
    this.deps.settings.set(CUSTOM_REGISTRY_KEY, [...registry, instance]);
    return instance;
  }

  /** Edits a custom instance's data. Undefined when the id is not ours. */
  updateCustom(
    id: string,
    patch: { name?: string; baseURL?: string; defaultModel?: string },
  ): CustomProviderInstance | undefined {
    const registry = this.listCustom();
    const current = registry.find((instance) => instance.id === id);
    if (current === undefined) return undefined;

    const updated: CustomProviderInstance = {
      ...current,
      ...(patch.name === undefined ? {} : { name: patch.name }),
      ...(patch.baseURL === undefined ? {} : { baseURL: normalizeCustomBaseUrl(patch.baseURL) }),
      ...(patch.defaultModel === undefined ? {} : { defaultModel: patch.defaultModel }),
    };
    this.deps.settings.set(
      CUSTOM_REGISTRY_KEY,
      registry.map((instance) => (instance.id === id ? updated : instance)),
    );
    if (patch.baseURL !== undefined && updated.baseURL !== current.baseURL) {
      this.invalidateCatalogCache(id);
    }
    return updated;
  }

  /**
   * Removes a custom instance and everything that was its: the registry row,
   * its sealed key, its chosen default and its catalog cache. A chat override
   * still naming the id silently degrades to the global default, like any
   * other broken override.
   */
  deleteCustom(id: string): boolean {
    const registry = this.listCustom();
    if (!registry.some((instance) => instance.id === id)) return false;
    this.deps.settings.set(
      CUSTOM_REGISTRY_KEY,
      registry.filter((instance) => instance.id !== id),
    );
    this.deps.secrets.delete(keySecretName(id));
    // Out of the list and the switches too, or a deleted instance keeps a
    // position (and a disabled flag) that its id could inherit later.
    this.deps.settings.set(
      ORDER_KEY,
      (this.deps.settings.get<string[]>(ORDER_KEY) ?? []).filter((entry) => entry !== id),
    );
    this.deps.settings.set(
      DISABLED_KEY,
      this.disabledIds().filter((entry) => entry !== id),
    );
    // The settings repo has no delete; emptied values mean the same thing.
    this.deps.settings.set(`provider.${id}.defaultModel`, '');
    this.deps.settings.set(`models.${id}`, { fetchedAt: 0, models: [] });
    this.deps.cooldown?.clear(id);
    this.electDefault();
    return true;
  }

  /**
   * One-time boot migration from the single-slot era (pop-agent.spec §15): a
   * legacy `provider.custom.config` and/or `provider.custom.apiKey` becomes
   * one registry instance, key and all, and the legacy entries are removed.
   * The instance's id is remembered as an alias, so a chat override still
   * saying `custom` resolves to it. Idempotent: with nothing legacy left,
   * this is a no-op.
   */
  migrateLegacyCustom(): void {
    const legacy = this.deps.settings.get<LegacyCustomConfig>(LEGACY_CUSTOM_CONFIG_KEY);
    const legacyKey = this.deps.secrets.get(keySecretName(LEGACY_CUSTOM_ID));
    const hasConfig = legacy !== undefined && legacy.baseURL.length > 0;
    const hasKey = legacyKey !== undefined && legacyKey.length > 0;
    if (!hasConfig && !hasKey) return;

    const instance = this.createCustom({
      name: 'Custom (OpenAI-compatible)',
      baseURL: legacy?.baseURL ?? '',
      defaultModel: legacy?.defaultModel ?? '',
    });
    // Only a registry already at the ceiling can refuse, which cannot be true
    // on the single-slot install this migration exists for.
    if (instance === undefined) return;
    if (hasKey) this.deps.secrets.set(keySecretName(instance.id), legacyKey);
    this.deps.secrets.delete(keySecretName(LEGACY_CUSTOM_ID));
    this.deps.settings.set(LEGACY_CUSTOM_CONFIG_KEY, { baseURL: '', defaultModel: '' });
    this.deps.settings.set(CUSTOM_ALIAS_KEY, instance.id);
  }

  /** The provider's default model, user-chosen or the definition's. */
  setDefaultModel(providerId: string, model: string): void {
    const definition = this.definition(providerId);
    if (definition === undefined) return;
    if (definition.customBaseURL) {
      // A custom instance's model is registry data, like the rest of it.
      this.updateCustom(definition.id, { defaultModel: model });
    } else {
      // Empty means "back to the definition's default" (no delete on the repo).
      this.deps.settings.set(`provider.${providerId}.defaultModel`, model);
    }
    // electDefault keeps "#1" and "what a new chat uses" the same statement,
    // but it returns early when the provider is ALREADY the default -- so
    // editing the default provider's own model updated the card and nothing
    // else, and every new run kept asking for the model the card no longer
    // showed. Maritaca configured sabiazinho-4, runs asking sabia-4
    // (Vinicius, 05/08). The elected pair follows the card it points at.
    if (this.canonicalId(this.deps.defaults().provider) === definition.id) {
      this.deps.setDefaultProvider?.(definition.id, this.ref(definition.id, '').modelId);
    }
  }

  /**
   * The Service Model of one provider (pop-agent.spec §15, corrected 07/08).
   *
   * Pop Agent runs two kinds of call: the Chat Model, which the user talks to, and
   * the Service Model, which does Pop Agent's own work -- naming a conversation,
   * summarizing it, tidying a transcript. They were one global setting, which
   * was mono-provider thinking: the stored value was a model id, and a model id
   * only means something inside one provider's catalog. An install whose
   * service model said `moonshotai/kimi-k3` asked OpenAI for a model OpenAI has
   * never heard of the moment a chat ran there.
   *
   * Empty means "the same as this provider's chat model", and that is a
   * fallback rather than a value copied when the provider is created. A copy
   * would be a second thing to keep in sync: change the chat model six months
   * later and the copy still names the model you left behind -- which, for a
   * custom endpoint, may no longer be served at all. Following costs nothing
   * and is never stale, and the moment the user picks a cheaper model here the
   * following stops.
   */
  serviceModel(providerId: string): string {
    const id = this.canonicalId(providerId);
    const stored = this.deps.settings.get<string>(`provider.${id}.serviceModel`);
    if (stored !== undefined && stored.length > 0) return stored;
    return this.chatModelOf(id);
  }

  /**
   * A provider's Chat Model, read straight from the definition and settings.
   *
   * It deliberately does not go through `status()` or `ref()`, which look like
   * the obvious way to ask: `status()` reports the service model, so asking it
   * from here is a loop that only ends in a stack overflow. The duplication is
   * three lines and the alternative is a cycle.
   */
  private chatModelOf(providerId: string): string {
    const definition = this.definition(providerId);
    if (definition === undefined) return '';
    // A custom instance's model is registry data; a builtin's is in settings.
    return definition.customBaseURL
      ? definition.defaultModel
      : this.storedDefaultModel(definition.id) ?? definition.defaultModel;
  }

  /** Empty puts the provider back to following its chat model. */
  setServiceModel(providerId: string, model: string): void {
    const definition = this.definition(providerId);
    if (definition === undefined) return;
    this.deps.settings.set(`provider.${definition.id}.serviceModel`, model);
  }

  /**
   * Which pair a service task should run on (the note of 07/08, §7): the
   * provider is inherited from whatever the task serves -- a title inherits its
   * chat's -- and a job with no parent chat falls through to the global
   * default, which is the head of the priority list. The model is that
   * provider's service model, never a global one.
   */
  resolveServiceModel(context: { provider?: string } = {}): ModelRef {
    const [first] = this.resolveServiceChain(context);
    return first ?? this.ref(DEFAULT_PROVIDER_ID, '');
  }

  /** The same chain a chat run would get, each entry wearing its service model. */
  resolveServiceChain(context: { provider?: string } = {}): ModelRef[] {
    const override =
      context.provider === undefined || context.provider.length === 0
        ? undefined
        : { provider: context.provider };
    return this.resolveChain(override).map((ref) => ({
      providerId: ref.providerId,
      modelId: this.serviceModel(ref.providerId),
    }));
  }

  /**
   * Runs one of Pop Agent's own completions over that chain (pop-agent.spec §15 fase 2,
   * confirmed 07/08). A service task is not special: when the provider it
   * inherited refuses, it moves down the same list a chat run would.
   *
   * It tries every remaining provider rather than consulting `shouldFailOver`,
   * and that is a deliberate difference from a chat run. That predicate reads a
   * status code, and the HTTP gateway does not carry one -- a
   * `ProviderGatewayError` is a message and nothing else. Given the choice
   * between guessing a class from prose and spending one more very small call,
   * this spends the call: these prompts are a few hundred tokens and the
   * alternative is a chat that silently keeps its fallback title.
   */
  async completeAsService(
    request: { prompt: string; maxTokens: number },
    context: { provider?: string; model?: string } = {},
  ): Promise<{ text: string; providerId: string; modelId: string }> {
    const resolved = this.resolveServiceChain(context);
    // A caller-named model (the voice-cleanup override in Settings) replaces
    // the FIRST entry's model and nothing else. A model id belongs to one
    // provider's catalog, so carrying it down the chain would ask the fallback
    // provider for a model it has never heard of -- the exact bug this whole
    // correction is about.
    const chain =
      context.model === undefined || context.model.length === 0
        ? resolved
        : resolved.map((ref, index) => (index === 0 ? { ...ref, modelId: context.model! } : ref));
    let last: Error | undefined;

    for (const ref of chain) {
      const definition = this.definition(ref.providerId);
      const gateway = definition === undefined ? undefined : this.gatewayFor(definition);
      const apiKey = this.apiKey(ref.providerId);
      const viaGateway = gateway !== undefined && apiKey !== undefined;
      // A subscription reaches the model through the engine, which holds its
      // credential. Requiring a gateway AND a key here is what kept titles,
      // distilled skills and voice cleanup off a provider the user had put
      // first in the chain, silently, for as long as a paid provider sat
      // behind it to absorb the fall-through (Vinicius, 08/08).
      if (!viaGateway && !this.deps.engineHasAuth(ref.providerId)) {
        last = new ProviderGatewayError(`No usable credential for "${ref.providerId}".`);
        continue;
      }
      try {
        const text = viaGateway
          ? await gateway.complete({
              apiKey,
              model: ref.modelId,
              prompt: request.prompt,
              maxTokens: request.maxTokens,
            })
          : await this.deps.engineComplete({
              providerId: ref.providerId,
              modelId: ref.modelId,
              prompt: request.prompt,
              maxTokens: request.maxTokens,
            });
        this.deps.cooldown?.clear(ref.providerId);
        return { text, providerId: ref.providerId, modelId: ref.modelId };
      } catch (error) {
        this.deps.cooldown?.penalize(ref.providerId);
        last = error instanceof Error ? error : new Error('unknown');
      }
    }

    throw last ?? new ProviderGatewayError('No provider is configured for background work.');
  }

  private storedDefaultModel(providerId: string): string | undefined {
    const stored = this.deps.settings.get<string>(`provider.${providerId}.defaultModel`);
    return stored !== undefined && stored.length > 0 ? stored : undefined;
  }

  /**
   * Which pair should actually run (pop-agent.spec §15): a chat override wins when
   * it is usable; otherwise the global default; when the default's key is
   * gone the next configured provider is elected -- the slot is never empty.
   * With nothing configured at all the default pair is answered anyway, and
   * the engine's error points the user to Settings.
   */
  resolve(override?: { provider?: string; model?: string }): ModelRef {
    const candidates = this.candidates(override);
    for (const candidate of candidates) {
      if (this.usable(candidate.providerId)) return candidate;
    }
    // Nothing usable: answer the head of the list (never the unusable
    // override), so the run fails with the error that points at Settings.
    return this.candidates()[0] ?? this.ref(DEFAULT_PROVIDER_ID, '');
  }

  /**
   * The failover chain for a run (pop-agent.spec §15, fase 2): every usable pair
   * in resolution order -- override first, then the global default, then the
   * remaining definitions -- one entry per provider. Penalized providers are
   * filtered out, unless that would empty the chain (the cooldown is
   * advisory). With nothing usable at all it degrades to `[resolve()]`, so
   * the run still fails with the error that points at Settings.
   */
  resolveChain(override?: { provider?: string; model?: string }): ModelRef[] {
    const chain: ModelRef[] = [];
    const seen = new Set<string>();
    for (const candidate of this.candidates(override)) {
      if (seen.has(candidate.providerId)) continue;
      seen.add(candidate.providerId);
      if (this.usable(candidate.providerId)) chain.push(candidate);
    }
    if (chain.length === 0) return [this.resolve(override)];
    return this.deps.cooldown?.admissible(chain) ?? chain;
  }

  /**
   * Resolution order: the chat's own override, then the priority list. That
   * is the whole rule. The global default does NOT get an entry of its own --
   * it used to, ahead of the list, which made it a hidden #0 the user could
   * not see or move: an install whose stored default was a dead endpoint kept
   * starting there however the list was arranged. The default is derived from
   * the list (`electDefault`), never a competing opinion about order.
   */
  private candidates(override?: { provider?: string; model?: string }): ModelRef[] {
    const candidates: ModelRef[] = [];
    if (override !== undefined && override.provider !== undefined && override.provider.length > 0) {
      candidates.push(this.ref(this.canonicalId(override.provider), override.model));
    }
    // The head keeps the globally chosen model when it is that provider's:
    // the list decides WHO answers, the model picker decides WITH WHAT. Any
    // other entry falls back to its own default model.
    const defaults = this.deps.defaults();
    const defaultProvider = this.canonicalId(defaults.provider);
    for (const id of this.order()) {
      candidates.push(this.ref(id, id === defaultProvider ? defaults.model : ''));
    }
    return candidates;
  }

  /** Whether a provider could serve a run right now: key or subscription. */
  private usable(providerId: string): boolean {
    // Switched off is switched off, even for a chat that names it: the run
    // falls through to the next candidate instead of failing.
    if (!this.isEnabled(providerId)) return false;
    if (this.definition(providerId)?.authType === 'oauth') {
      return this.deps.engineHasAuth(providerId);
    }
    return this.apiKey(providerId) !== undefined;
  }

  private ref(providerId: string, modelId: string | undefined): ModelRef {
    const definition = this.definition(providerId);
    const configured = this.status(providerId)?.defaultModel ?? '';
    const fallback = definition?.defaultModel ?? '';
    return {
      providerId,
      modelId:
        modelId !== undefined && modelId.length > 0 ? modelId : configured || fallback,
    };
  }

  /**
   * Custom instances as the ENGINE needs them: the data the user typed, plus
   * every model this endpoint is known to serve.
   *
   * The engine registers a provider with exactly these models and refuses
   * anything else, so the list has to travel all the way there. Passing only
   * `defaultModel` is what made five of Maritaca's six models unusable
   * (Vinicius, 05/08).
   */
  customProvidersForEngine(): {
    id: string;
    name: string;
    baseURL: string;
    defaultModel: string;
    models: { id: string; context?: number }[];
  }[] {
    return this.listCustom().map((instance) => ({
      id: instance.id,
      name: instance.name,
      baseURL: instance.baseURL,
      defaultModel: instance.defaultModel,
      models: customProviderDefinition(instance, this.cachedModels(instance.id)).staticModels.map(
        (model) => ({
          id: model.id,
          ...(model.context === undefined ? {} : { context: model.context }),
        }),
      ),
    }));
  }

  /**
   * What a custom endpoint last said it serves. Read, never fetched: this is
   * consulted while building definitions, which happens on every request.
   */
  private cachedModels(id: string): readonly { id: string; context?: number }[] {
    return this.deps.settings.get<CatalogCache>(`models.${id}`)?.models ?? [];
  }

  /** Builtins plus the custom instances, the whole list everything iterates. */
  private definitions(): ProviderDefinition[] {
    return allProviderDefinitions(this.listCustom(), (id) => this.cachedModels(id));
  }

  /** Any provider by id: a builtin, or a registry instance dressed as one. */
  private definition(providerId: string): ProviderDefinition | undefined {
    const id = this.canonicalId(providerId);
    const builtin = providerDefinition(id);
    if (builtin !== undefined) return builtin;
    const instance = this.listCustom().find((entry) => entry.id === id);
    return instance === undefined
      ? undefined
      : customProviderDefinition(instance, this.cachedModels(instance.id));
  }

  /**
   * The single-slot era stored `custom` on chats; the migration remembers
   * which instance that became, and this maps the old name to it.
   */
  private canonicalId(providerId: string): string {
    if (providerId !== LEGACY_CUSTOM_ID) return providerId;
    return this.deps.settings.get<string>(CUSTOM_ALIAS_KEY) ?? providerId;
  }

  private authErrorAt(providerId: string): string | undefined {
    const stored = this.deps.settings.get<string>(`provider.${providerId}.authErrorAt`);
    return stored !== undefined && stored.length > 0 ? stored : undefined;
  }

  /** Clears the auth-failure marker; empty means absent (no delete on the repo). */
  private clearAuthError(providerId: string): void {
    this.deps.settings.set(`provider.${this.canonicalId(providerId)}.authErrorAt`, '');
  }

  /** Drops a cached catalog so the next models() fetch hits the endpoint. */
  private invalidateCatalogCache(providerId: string): void {
    const id = this.canonicalId(providerId);
    this.deps.settings.set(`models.${id}`, { fetchedAt: 0, models: [] });
  }

  /** The gateway for a provider: a builtin's own, or one for a custom URL. */
  private gatewayFor(definition: ProviderDefinition): ProviderGateway | undefined {
    const builtin = this.deps.gateways[definition.id];
    if (builtin !== undefined) return builtin;
    if (definition.customBaseURL && definition.baseURL.length > 0) {
      return this.deps.customGateway?.(definition.baseURL);
    }
    return undefined;
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
    const definition = this.definition(providerId);
    if (definition !== undefined && definition.authType === 'oauth') {
      // The same test every other provider gets: one tiny request, timed. It
      // used to read the stored credential instead and report no latency,
      // because a figure for a round trip that never happened would be a lie
      // (Vinicius, 04/08) -- true, so the trip is made rather than the number
      // invented. Two ways of answering "does this provider work?" was one
      // too many (Vinicius, 08/08). A subscription is not billed per token,
      // so it costs nothing but the moment.
      const startedAuth = this.deps.clock.now();
      try {
        await this.deps.engineComplete({
          providerId,
          modelId: this.ref(providerId, '').modelId,
          prompt: TEST_PROMPT,
          maxTokens: TEST_MAX_TOKENS,
        });
        this.deps.cooldown?.clear(providerId);
        this.clearAuthError(providerId);
        this.deps.cooldown?.clear(providerId);
        return { ok: true, latencyMs: this.deps.clock.now() - startedAuth };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : 'The check failed.',
          latencyMs: this.deps.clock.now() - startedAuth,
        };
      }
    }
    if (definition === undefined) {
      return { ok: false, message: `Unknown provider "${providerId}".` };
    }
    const gateway = this.gatewayFor(definition);
    if (gateway === undefined) {
      return definition.customBaseURL
        ? { ok: false, message: 'Set the endpoint URL before testing.' }
        : { ok: false, message: `Unknown provider "${providerId}".` };
    }
    const key = apiKey ?? this.apiKey(definition.id);
    if (key === undefined || key.length === 0) {
      return { ok: false, message: 'No API key to test.' };
    }
    const model = this.ref(definition.id, '').modelId;
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
      this.deps.cooldown?.clear(providerId);
      this.clearAuthError(providerId);
      return { ok: true, latencyMs: this.deps.clock.now() - started };
    } catch (error) {
      const latencyMs = this.deps.clock.now() - started;
      // Answered, just without words: the key and the endpoint are fine, and
      // that is the whole question a connection test asks. TEST_MAX_TOKENS is
      // five, which a reasoning model spends on thinking alone.
      if (error instanceof ProviderGatewayError && error.reachable) {
        this.deps.cooldown?.clear(providerId);
        this.clearAuthError(providerId);
        return { ok: true, latencyMs };
      }
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'The test failed.',
        latencyMs,
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
    const definition = this.definition(providerId);
    if (definition === undefined) return { models: [], source: 'static' };
    const cacheKey = `models.${definition.id}`;
    const gateway = this.gatewayFor(definition);

    const key = this.apiKey(definition.id);
    if (key !== undefined && gateway !== undefined) {
      const cached = this.deps.settings.get<CatalogCache>(cacheKey);
      if (
        cached !== undefined &&
        cached.models.length > 0 &&
        this.deps.clock.now() - cached.fetchedAt < CATALOG_TTL_MS
      ) {
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
        if (cached !== undefined && cached.models.length > 0) {
          return { models: cached.models, source: 'cache' };
        }
      }
    }

    try {
      const models = await this.deps.engineModels(definition.id);
      if (models.length > 0) return { models, source: 'engine' };
    } catch {
      // The engine failing to list models must not take the catalog down.
    }
    // A custom instance's static catalog is its configured model, already
    // synthesized into the definition.
    return { models: [...definition.staticModels], source: 'static' };
  }
}

/** Production id randomness: 5 bytes, 10 hex characters. */
function defaultCustomIdSource(): string {
  return randomBytes(5).toString('hex');
}
