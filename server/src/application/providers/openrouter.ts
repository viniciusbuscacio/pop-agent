import type { ModelInfo } from '../ports/agent-bridge.js';

/**
 * The one provider v0.1 ships with (pop-agent.spec §15). The id and the default
 * model are product decisions, so they live here rather than in the pi
 * adapter that happens to use them.
 */
export const OPENROUTER_PROVIDER_ID = 'openrouter';

export const DEFAULT_MODEL_ID = 'moonshotai/kimi-k3';

/**
 * The catalog of last resort: what `GET /v1/models` answers when there is no
 * key for a live fetch and no engine catalog to fall back on. One row,
 * because one model is all Pop Agent promises to work with (pop-agent.spec §15).
 */
export const FALLBACK_MODELS: ModelInfo[] = [
  {
    id: DEFAULT_MODEL_ID,
    name: 'MoonshotAI: Kimi K3',
    context: 1_048_576,
    pricing: { input: 3, output: 15 },
  },
];
