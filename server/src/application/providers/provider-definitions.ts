import type { ModelInfo } from '../ports/agent-bridge.js';

/**
 * The declarative provider list (popy.spec §15: "provider is data, not a
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
    // Subscription auth (popy.spec §15, fase 1.5): pi's own OAuth flow signs
    // in with a ChatGPT Plus/Pro account; no key exists anywhere in Popy.
    id: 'openai-codex',
    name: 'OpenAI — ChatGPT subscription',
    baseURL: '',
    authType: 'oauth',
    defaultModel: 'gpt-5.5',
    allowCustomModel: false,
    customBaseURL: false,
    staticModels: [
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
    defaultModel: 'gpt-5.4',
    allowCustomModel: false,
    customBaseURL: false,
    staticModels: [
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
  {
    id: 'custom',
    name: 'Custom (OpenAI-compatible)',
    baseURL: '',
    authType: 'api-key',
    defaultModel: '',
    allowCustomModel: true,
    customBaseURL: true,
    // A custom endpoint's catalog cannot be guessed; the configured model is it.
    staticModels: [],
  },
];

export const DEFAULT_PROVIDER_ID = 'openrouter';

export function providerDefinition(id: string): ProviderDefinition | undefined {
  return PROVIDER_DEFINITIONS.find((definition) => definition.id === id);
}

/** Where a provider's key lives in the sealed secrets store. */
export function keySecretName(providerId: string): string {
  return `provider.${providerId}.apiKey`;
}
