/**
 * Cleaning up a raw voice transcript with one cheap LLM call (pop-agent.spec §14,
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
  /**
   * One background completion on the default provider (pop-agent.spec §15): a voice
   * note has no parent chat to inherit a provider from, so it takes the head of
   * the priority list. `model` overrides the provider's Service Model when the
   * user named one in Settings.
   */
  complete: (
    request: { prompt: string; maxTokens: number },
    context: { model?: string },
  ) => Promise<string>;
  /** Off = the raw transcript goes straight through, no tokens, no waiting. */
  enabled: () => boolean;
  /** Empty means "whatever the provider's Service Model is". */
  model: () => string;
}

export class VoiceCleanup {
  constructor(private readonly deps: VoiceCleanupDeps) {}

  async clean(transcript: string): Promise<string> {
    const trimmed = transcript.trim();
    if (trimmed.length === 0) return trimmed;
    if (!this.deps.enabled()) return trimmed;

    try {
      const override = this.deps.model();
      const improved = await this.deps.complete(
        { prompt: `${PROMPT}\n${trimmed}`, maxTokens: MAX_TOKENS },
        override.length === 0 ? {} : { model: override },
      );
      const result = improved.trim();
      return result.length > 0 ? result : trimmed;
    } catch {
      return trimmed; // best-effort: the raw text is still useful
    }
  }
}
