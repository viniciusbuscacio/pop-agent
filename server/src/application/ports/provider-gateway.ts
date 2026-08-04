import type { ModelInfo } from './agent-bridge.js';

/**
 * The provider's plain HTTP face (popy.spec §15): the model catalog and the
 * one-shot completions that do not belong to a conversation -- the key test
 * now, titles and summaries in the next step. Anything conversational goes
 * through the AgentBridge instead.
 */

/** The provider said no; its own words are worth keeping for the user. */
export class ProviderGatewayError extends Error {
  /**
   * The provider was reached and answered properly -- it just did not produce
   * text. Real work still fails on that (a title needs words), but a
   * *connection* test must not: a reasoning model handed a five-token ceiling
   * spends them thinking and returns an empty message, which said "your key
   * is broken" about a key that worked perfectly (Vinicius, 04/08).
   */
  readonly reachable: boolean;

  constructor(message: string, options: { reachable?: boolean } = {}) {
    super(message);
    this.name = 'ProviderGatewayError';
    this.reachable = options.reachable ?? false;
  }
}

export interface CompletionRequest {
  apiKey: string;
  model: string;
  prompt: string;
  maxTokens: number;
}

export interface ProviderGateway {
  /** The provider's live catalog. The key is optional where the catalog is public. */
  listModels(apiKey: string | undefined): Promise<ModelInfo[]>;

  /** One prompt, one short answer, outside any session. */
  complete(request: CompletionRequest): Promise<string>;
}
