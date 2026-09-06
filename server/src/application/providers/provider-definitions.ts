import type { ModelInfo } from '../ports/agent-bridge.js';

/**
 * The declarative provider list (docs/specs/Spec-Pop-General.md §15: "provider is data, not a
 * class"). Behaviour varies only by auth type -- `api-key` stores a key in
 * the secrets table, `oauth` rides a subscription credential pi's login flow
 * persisted -- and a vendor quirk is a point `if` somewhere, never a
 * subclass. Adding a provider means adding a literal here.
 *
 * The ids deliberately match pi-ai's builtin provider ids so the engine's
 * `ModelRuntime.getModel(providerId, modelId)` resolves them without a
 * translation table. `custom` is the exception: pi has no builtin for it,
 * so the engine registers it as an OpenAI-compatible provider with the
 * user-supplied baseURL.
 */
export interface ProviderDefinition {
  id: string;
  name: string;
  /** Informational; the real transport base URL lives in pi's provider. */
  baseURL: string;
  authType: 'api-key' | 'oauth';
  defaultModel: string;
  allowCustomModel: boolean;
  /** True when pi needs `registerProvider` instead of a builtin. */
  customBaseURL: boolean;
  /** The catalog of last resort, when live fetch, cache and engine all fail. */
  staticModels: ModelInfo[];
}

export const PROVIDER_DEFINITIONS: readonly ProviderDefinition[] = [
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    authType: 'api-key',
    defaultModel: 'moonshotai/kimi-k3',
    allowCustomModel: true,
    customBaseURL: false,
    staticModels: [
      {
        id: 'moonshotai/kimi-k3',
        name: 'MoonshotAI: Kimi K3',
        context: 1_048_576,
        pricing: { input: 3, output: 15 },
      },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    authType: 'api-key',
    defaultModel: 'gpt-4o-mini',
    allowCustomModel: true,
    customBaseURL: false,
    staticModels: [
      { id: 'gpt-4o-mini', name: 'GPT-4o mini', context: 128_000 },
      { id: 'gpt-4o', name: 'GPT-4o', context: 128_000 },
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    baseURL: 'https://api.anthropic.com',
    authType: 'api-key',
    defaultModel: 'claude-sonnet-4-5',
    allowCustomModel: true,
    customBaseURL: false,
    staticModels: [
      { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', context: 200_000 },
      { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', context: 200_000 },
    ],
  },
  {
    // Subscription auth (docs/specs/Spec-Pop-General.md §15, fase 1.5): pi's own OAuth flow signs
    // in with a ChatGPT Plus/Pro account; no key exists anywhere in Pop Agent.
    id: 'openai-codex',
    name: 'OpenAI — ChatGPT subscription',
    baseURL: '',
    authType: 'oauth',
    defaultModel: 'gpt-5.6-sol',
    allowCustomModel: false,
    customBaseURL: false,
    staticModels: [
      { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' },
      { id: 'gpt-5.4', name: 'GPT-5.4', context: 272_000, pricing: { input: 2.5, output: 15 } },
      { id: 'gpt-5.5', name: 'GPT-5.5', context: 272_000, pricing: { input: 5, output: 30 } },
      {
        id: 'gpt-5.6-luna',
        name: 'GPT-5.6 Luna',
        context: 272_000,
        pricing: { input: 1, output: 6 },
      },
    ],
  },
  {
    // Subscription auth, same shape: a GitHub Copilot seat via device code.
    id: 'github-copilot',
    name: 'GitHub Copilot subscription',
    baseURL: '',
    authType: 'oauth',
    defaultModel: 'gpt-5.6-sol',
    allowCustomModel: false,
    customBaseURL: false,
    staticModels: [
      { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' },
      { id: 'gpt-5.4', name: 'GPT-5.4', context: 1_000_000, pricing: { input: 2.5, output: 15 } },
      {
        id: 'claude-opus-5',
        name: 'Claude Opus 5',
        context: 1_000_000,
        pricing: { input: 5, output: 25 },
      },
      {
        id: 'gemini-3.5-flash',
        name: 'Gemini 3.5 Flash',
        context: 200_000,
        pricing: { input: 1.5, output: 9 },
      },
    ],
  },
];

export const DEFAULT_PROVIDER_ID = 'openrouter';

/** Looks up a BUILTIN definition; custom instances live in the registry. */
export function providerDefinition(id: string): ProviderDefinition | undefined {
  return PROVIDER_DEFINITIONS.find((definition) => definition.id === id);
}

/**
 * Whether a provider charges for the tokens a run spends (docs/specs/Spec-Pop-General.md §14, §15).
 *
 * A subscription does not. pi reports a `cost` for every run regardless --
 * tokens times the model's catalogue price -- which is the real bill for an
 * api-key provider and pure fiction for an OAuth one. Booking that fiction
 * made Settings -> Usage overstate real spending by ~US$4.90 across 151 runs
 * before anyone noticed, and a screen about money must never round upward
 * (Vinicius, 03/08).
 *
 * A provider nobody recognises is assumed to bill: a custom OpenAI-compatible
 * endpoint is somebody's paid key, and guessing "free" would hide a real cost.
 */
export function billsPerToken(providerId: string): boolean {
  return providerDefinition(providerId)?.authType !== 'oauth';
}

/** Where a provider's key lives in the sealed secrets store. */
export function keySecretName(providerId: string): string {
  return `provider.${providerId}.apiKey`;
}

/**
 * One user-created OpenAI-compatible provider (docs/specs/Spec-Pop-General.md §15): pure data in
 * the settings registry, unlimited instances. The key is NOT here -- it sits
 * in the secrets store under {@link keySecretName} like everyone else's.
 */
export interface CustomProviderInstance {
  /** `custom-` + 5 random hex bytes, unique within the registry. */
  id: string;
  name: string;
  baseURL: string;
  defaultModel: string;
}

/** A registry instance dressed as a definition, so nothing downstream cares. */
export function customProviderDefinition(
  instance: CustomProviderInstance,
  /**
   * What this endpoint said it serves, when it has been asked (the cached
   * catalog). Empty or absent falls back to the configured model alone.
   */
  knownModels: readonly { id: string; name?: string; context?: number }[] = [],
): ProviderDefinition {
  /**
   * Every model this endpoint is known to have -- not just the configured
   * one (Vinicius, 05/08).
   *
   * The engine registers a provider with exactly these, and then refuses any
   * model that is not among them. Registering only `defaultModel` meant the
   * picker offered six models the endpoint really has, five of which failed
   * with `model_not_available` -- and, worse, the run hung rather than said
   * so, because the failure surfaced while the session was being opened.
   *
   * The configured model stays in the list even when the catalog does not
   * mention it: it is what the user typed, and an endpoint that lists
   * nothing (or lists late) must still answer for it.
   */
  const catalog = knownModels.map((model) => ({
    id: model.id,
    name: model.name ?? model.id,
    ...(model.context === undefined ? {} : { context: model.context }),
  }));
  const configured =
    instance.defaultModel.length > 0 && !catalog.some((m) => m.id === instance.defaultModel)
      ? [{ id: instance.defaultModel, name: instance.defaultModel }]
      : [];

  return {
    id: instance.id,
    name: instance.name,
    baseURL: instance.baseURL,
    authType: 'api-key',
    defaultModel: instance.defaultModel,
    allowCustomModel: true,
    customBaseURL: true,
    staticModels: [...configured, ...catalog],
  };
}

/** The whole provider list: the builtins, then the customs in registry order. */
export function allProviderDefinitions(
  customs: readonly CustomProviderInstance[],
  /** The cached catalog per custom id, when the caller has one. */
  knownModels: (id: string) => readonly { id: string; name?: string; context?: number }[] = () =>
    [],
): ProviderDefinition[] {
  return [
    ...PROVIDER_DEFINITIONS,
    ...customs.map((instance) => customProviderDefinition(instance, knownModels(instance.id))),
  ];
}

/**
 * What the user pastes is often the full endpoint; what pi needs is the base.
 * Trailing slashes and a trailing `/chat/completions` are stripped, nothing
 * else -- the UI shows the result live, so a surprise is impossible.
 */
export function normalizeCustomBaseUrl(url: string): string {
  return url
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/chat\/completions$/i, '')
    .replace(/\/+$/, '');
}
