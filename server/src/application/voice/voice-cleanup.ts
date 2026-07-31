import type { ProviderGateway } from '../ports/provider-gateway.js';

/**
 * Cleaning up a raw voice transcript with one cheap LLM call (popy.spec §14,
 * aw's flow). whisper hears the words but not the punctuation; a single pass by
 * the service model fixes capitalization, sentence breaks and obvious mishears,
 * keeping the original language and adding nothing. Best-effort by contract: no
 * key, a refusal, a timeout -- the raw transcript is returned unchanged, so
 * voice never breaks because the cleanup did.
 */

const MAX_TOKENS = 400;

const PROMPT = [
  'Below is a raw speech-to-text transcript. Fix its punctuation,',
  'capitalization, sentence breaks and obvious transcription errors.',
  'Keep the original language and meaning. Do not add, remove or answer',
  'anything -- return only the corrected transcript, nothing else.',
  '',
  'Transcript:',
].join('\n');

export interface VoiceCleanupDeps {
  gateway: ProviderGateway;
  apiKey: () => string | undefined;
  serviceModel: () => string;
}

export class VoiceCleanup {
  constructor(private readonly deps: VoiceCleanupDeps) {}

  async clean(transcript: string): Promise<string> {
    const trimmed = transcript.trim();
    if (trimmed.length === 0) return trimmed;

    const key = this.deps.apiKey();
    if (key === undefined) return trimmed;

    try {
      const improved = await this.deps.gateway.complete({
        apiKey: key,
        model: this.deps.serviceModel(),
        prompt: `${PROMPT}\n${trimmed}`,
        maxTokens: MAX_TOKENS,
      });
      const result = improved.trim();
      return result.length > 0 ? result : trimmed;
    } catch {
      return trimmed; // best-effort: the raw text is still useful
    }
  }
}
