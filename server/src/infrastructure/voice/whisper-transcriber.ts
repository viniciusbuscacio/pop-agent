import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  TranscriberError,
  type TranscriptionJob,
  type Transcriber,
} from '../../application/ports/transcriber.js';
import { createExclusiveInternalFile } from '../process/internal-file.js';

/**
 * aw's local voice pipeline, ported: ffmpeg turns whatever the browser
 * recorded into 16 kHz mono WAV, whisper.cpp's whisper-cli turns the WAV into
 * words. Everything runs on the server's own CPU -- no tokens, no network.
 *
 * Installation supplies managed Whisper and audio-only FFmpeg. Configuration
 * can override them with POP_AGENT_WHISPER_CLI and POP_AGENT_FFMPEG; development
 * source builds can resolve host binaries through PATH. The GGML model is
 * selected separately and downloaded only when needed.
 */

const TRANSCRIBE_TIMEOUT_MS = 120_000;
/** aw's cap: 25 MB of audio is minutes of speech, not a podcast. */
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

export interface WhisperOptions {
  /** Path (or PATH-resolved name) of whisper.cpp's whisper-cli. */
  whisperCli: string;
  /** Path (or PATH-resolved name) of ffmpeg. */
  ffmpeg: string;
  /**
   * Resolves the GGML model to use, downloading it if needed. Async because a
   * model may not be on disk yet (docs/specs/Spec-Pop-General.md §14).
   */
  resolveModel: () => Promise<string>;
}

export class WhisperTranscriber implements Transcriber {
  constructor(private readonly options: WhisperOptions) {}

  async transcribe(job: TranscriptionJob): Promise<string> {
    const audio = Buffer.from(job.audioBase64, 'base64');
    if (audio.byteLength === 0) throw new TranscriberError('The recording was empty.');
    if (audio.byteLength > MAX_AUDIO_BYTES) {
      throw new TranscriberError('The recording is too large to transcribe (max 25 MB).');
    }

    const model = await this.options.resolveModel();
    if (model.length === 0) {
      throw new TranscriberError('No whisper model is available.');
    }

    const dir = mkdtempSync(join(tmpdir(), 'pop-voice-'));
    try {
      // Claim every internal path exclusively: even the astronomically unlikely
      // random-name collision must redraw rather than replace an input/output.
      const input = createExclusiveInternalFile(
        dir,
        'audio',
        safeExtension(job.format),
        audio,
      );
      const wav = createExclusiveInternalFile(dir, 'audio', 'wav');
      const transcript = createExclusiveInternalFile(dir, 'text', 'txt');
      const transcriptBase = transcript.slice(0, -'.txt'.length);

      // 16 kHz mono PCM is the one shape whisper.cpp accepts (aw's flags).
      await run(
        this.options.ffmpeg,
        ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav],
        'ffmpeg is required for voice transcription: reinstall the Pop audio runtime or set POP_AGENT_FFMPEG.',
      );

      // -l auto: the language is whatever was spoken. -nt: no timestamps.
      await run(
        this.options.whisperCli,
        ['-m', model, '-f', wav, '-l', 'auto', '-otxt', '-of', transcriptBase, '-nt'],
        'whisper-cli is not installed: build whisper.cpp or set POP_AGENT_WHISPER_CLI.',
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
