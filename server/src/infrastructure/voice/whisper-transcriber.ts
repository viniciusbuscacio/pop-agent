import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  TranscriberError,
  type TranscriptionJob,
  type Transcriber,
} from '../../application/ports/transcriber.js';

/**
 * aw's local voice pipeline, ported: ffmpeg turns whatever the browser
 * recorded into 16 kHz mono WAV, whisper.cpp's whisper-cli turns the WAV into
 * words. Everything runs on the server's own CPU -- no tokens, no network.
 *
 * Both binaries and the GGML model are found by configuration, not bundled:
 * `POPY_WHISPER_CLI`, `POPY_FFMPEG` (default: the names, resolved by PATH)
 * and `POPY_WHISPER_MODEL` (path to a ggml-*.bin). A missing piece fails with
 * the words to fix it.
 */

const TRANSCRIBE_TIMEOUT_MS = 120_000;
/** aw's cap: 25 MB of audio is minutes of speech, not a podcast. */
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

export interface WhisperOptions {
  /** Path (or PATH-resolved name) of whisper.cpp's whisper-cli. */
  whisperCli: string;
  /** Path (or PATH-resolved name) of ffmpeg. */
  ffmpeg: string;
  /** Path of the GGML model file. */
  modelPath: string | undefined;
}

export class WhisperTranscriber implements Transcriber {
  constructor(private readonly options: WhisperOptions) {}

  async transcribe(job: TranscriptionJob): Promise<string> {
    const model = this.options.modelPath;
    if (model === undefined || model.length === 0) {
      throw new TranscriberError(
        'No whisper model is configured: set POPY_WHISPER_MODEL to a ggml-*.bin file.',
      );
    }

    const audio = Buffer.from(job.audioBase64, 'base64');
    if (audio.byteLength === 0) throw new TranscriberError('The recording was empty.');
    if (audio.byteLength > MAX_AUDIO_BYTES) {
      throw new TranscriberError('The recording is too large to transcribe (max 25 MB).');
    }

    const dir = mkdtempSync(join(tmpdir(), 'popy-voice-'));
    try {
      // Distinct basenames: a recording that is already .wav must not collide
      // with ffmpeg's output (found the hard way).
      const input = join(dir, `source.${safeExtension(job.format)}`);
      const wav = join(dir, 'converted.wav');
      const transcriptBase = join(dir, 'transcript');
      writeFileSync(input, audio);

      // 16 kHz mono PCM is the one shape whisper.cpp accepts (aw's flags).
      await run(
        this.options.ffmpeg,
        ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav],
        'ffmpeg is required for voice transcription: install it (apt install ffmpeg) or set POPY_FFMPEG.',
      );

      // -l auto: the language is whatever was spoken. -nt: no timestamps.
      await run(
        this.options.whisperCli,
        ['-m', model, '-f', wav, '-l', 'auto', '-otxt', '-of', transcriptBase, '-nt'],
        'whisper-cli is not installed: build whisper.cpp or set POPY_WHISPER_CLI.',
      );

      return normalize(readFileSync(`${transcriptBase}.txt`, 'utf8'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

/** The format names a browser produces; anything else falls back to webm. */
function safeExtension(format: string): string {
  const clean = format.toLowerCase().replace(/[^a-z0-9]/g, '');
  return ['webm', 'mp4', 'm4a', 'wav', 'mp3', 'mpeg', 'ogg', 'flac', 'aac'].includes(clean)
    ? clean === 'mpeg'
      ? 'mp3'
      : clean
    : 'webm';
}

function run(command: string, args: string[], missingMessage: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { timeout: TRANSCRIBE_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
      (error, _stdout, stderr) => {
        if (error === null) {
          resolve();
          return;
        }
        const gone = (error as NodeJS.ErrnoException).code === 'ENOENT';
        reject(
          new TranscriberError(
            gone ? missingMessage : firstLine(stderr) ?? `${command} failed.`,
          ),
        );
      },
    );
  });
}

function firstLine(text: string): string | undefined {
  const line = text.split('\n').find((entry) => entry.trim().length > 0)?.trim();
  return line !== undefined && line.length > 0 ? line.slice(0, 300) : undefined;
}

/** whisper sometimes leaves [timestamps] or stray whitespace; aw strips both. */
function normalize(text: string): string {
  return text
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
