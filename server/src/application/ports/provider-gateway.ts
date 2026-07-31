import type { ModelInfo } from './agent-bridge.js';

/**
 * The provider's plain HTTP face (popy.spec §15): the model catalog and the
 * one-shot completions that do not belong to a conversation -- the key test
 * now, titles and summaries in the next step. Anything conversational goes
 * through the AgentBridge instead.
 */

/** The provider said no; its own words are worth keeping for the user. */
export class ProviderGatewayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderGatewayError';
  }
}

export interface CompletionRequest {
  apiKey: string;
  model: string;
  prompt: string;
  maxTokens: number;
}

export interface TranscriptionRequest {
  apiKey: string;
  /** An audio-capable model: the transcript is just its answer. */
  model: string;
  /** Base64 audio payload, without the data-URI prefix. */
  audioBase64: string;
  /** The container format, as the provider names it (webm, mp4, wav, mp3…). */
  format: string;
}

export interface ProviderGateway {
  /** The provider's live catalog. The key is optional where the catalog is public. */
  listModels(apiKey: string | undefined): Promise<ModelInfo[]>;

  /** One prompt, one short answer, outside any session. */
  complete(request: CompletionRequest): Promise<string>;

  /** Audio in, its words out. */
  transcribe(request: TranscriptionRequest): Promise<string>;
}
