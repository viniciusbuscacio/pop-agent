import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { VoiceModelStatus, VoiceModelStore } from '../../application/ports/voice-models.js';

/**
 * The whisper.cpp GGML models Pop Agent offers (docs/specs/Spec-Pop-General.md §14). Each is fetched on
 * demand into POP_AGENT_DATA_DIR/voice-models with its SHA1 verified against this
 * pinned manifest -- a corrupted or tampered download is rejected, not run. The
 * default is `base`: on this 4-core home server it runs ~0.5x realtime where
 * `small` takes ~1.7x and `medium` ~5.8x, and the measured transcription
 * quality was near-identical (decision of 31/07, revising the earlier
 * medium default).
 *
 * The manifest mirrors the whisper.cpp release checksums (the same ones aw
 * pins).
 */

const BASE_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';

export interface WhisperModelSpec {
  name: string;
  file: string;
  sha1: string;
  /** Rough size for the UI to warn before a large download. */
  approxMb: number;
}

export const WHISPER_MODELS: WhisperModelSpec[] = [
  { name: 'tiny', file: 'ggml-tiny.bin', sha1: 'bd577a113a864445d4c299885e0cb97d4ba92b5f', approxMb: 78 },
  { name: 'base', file: 'ggml-base.bin', sha1: '465707469ff3a37a2b9b8d8f89f2f99de7299dac', approxMb: 148 },
  { name: 'small', file: 'ggml-small.bin', sha1: '55356645c2b361a969dfd0ef2c5a50d530afd8d5', approxMb: 488 },
  { name: 'medium', file: 'ggml-medium.bin', sha1: 'fd9727b6e1217c2f614f9b698455c4ffd82463b4', approxMb: 1530 },
];

export const DEFAULT_WHISPER_MODEL = 'base';

export class WhisperModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WhisperModelError';
  }
}

export class WhisperModelStore implements VoiceModelStore {
  private downloading = new Map<string, Promise<string>>();

  constructor(private readonly dir: string) {}

  models(): WhisperModelSpec[] {
    return WHISPER_MODELS;
  }

  /** Each model and whether its file is already on disk. */
  async status(): Promise<VoiceModelStatus[]> {
    return Promise.all(
      WHISPER_MODELS.map(async (model) => ({
        name: model.name,
        approxMb: model.approxMb,
        installed: await this.exists(model.file),
      })),
    );
  }

  /** The local path of a model, downloading and verifying it if missing. */
  async ensure(name: string): Promise<string> {
    const spec = WHISPER_MODELS.find((model) => model.name === name);
    if (spec === undefined) throw new WhisperModelError(`Unknown whisper model "${name}".`);

    const path = join(this.dir, spec.file);
    if (await this.exists(spec.file)) return path;

    // One download per model at a time, even if two requests race.
    let inflight = this.downloading.get(name);
    if (inflight === undefined) {
      inflight = this.download(spec, path).finally(() => this.downloading.delete(name));
      this.downloading.set(name, inflight);
    }
    return inflight;
  }

  private async download(spec: WhisperModelSpec, path: string): Promise<string> {
    await mkdir(this.dir, { recursive: true });
    const temp = `${path}.download`;

    const response = await fetch(`${BASE_URL}/${spec.file}`);
    if (!response.ok || response.body === null) {
      throw new WhisperModelError(`Could not download ${spec.file} (${String(response.status)}).`);
    }

    const hash = createHash('sha1');
    const body = Readable.fromWeb(response.body as never);
    body.on('data', (chunk: Buffer) => hash.update(chunk));
    await pipeline(body, createWriteStream(temp));

    const digest = hash.digest('hex');
    if (digest !== spec.sha1) {
      await unlink(temp).catch(() => undefined);
      throw new WhisperModelError(`${spec.file} failed its checksum -- refusing to use it.`);
    }
    await rename(temp, path);
    return path;
  }

  private async exists(file: string): Promise<boolean> {
    try {
      const info = await stat(join(this.dir, file));
      return info.size > 0;
    } catch {
      return false;
    }
  }
}
