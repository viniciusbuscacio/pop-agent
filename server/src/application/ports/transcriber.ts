/**
 * Voice into text (popy.spec §14, aw's flow). The adapter is whisper.cpp on
 * the server's own CPU -- transcription costs electricity, not tokens
 * (decision of 31/07/2026, replacing the short-lived cloud route).
 */

export interface TranscriptionJob {
  /** Base64 audio payload, without the data-URI prefix. */
  audioBase64: string;
  /** The container format as the browser named it (webm, mp4, wav, mpeg…). */
  format: string;
}

export class TranscriberError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TranscriberError';
  }
}

export interface Transcriber {
  /** The words that were said. Throws {@link TranscriberError} with words the user can act on. */
  transcribe(job: TranscriptionJob): Promise<string>;
}
