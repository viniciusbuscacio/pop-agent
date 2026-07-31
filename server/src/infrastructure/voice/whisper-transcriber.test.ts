import { describe, expect, it } from 'vitest';
import { TranscriberError } from '../../application/ports/transcriber.js';
import { WhisperTranscriber } from './whisper-transcriber.js';

/**
 * The pipeline itself needs ffmpeg and whisper.cpp, which the CI does not
 * have -- the behavioural check runs on the dev server. What is tested here
 * is everything around the binaries: the guards, and that a missing piece
 * fails with the words to fix it.
 */

const JOB = { audioBase64: Buffer.from('fake audio').toString('base64'), format: 'webm' };

function transcriber(overrides: Partial<ConstructorParameters<typeof WhisperTranscriber>[0]> = {}) {
  return new WhisperTranscriber({
    whisperCli: 'popy-test-missing-whisper-cli',
    ffmpeg: 'popy-test-missing-ffmpeg',
    modelPath: '/nowhere/ggml-small.bin',
    ...overrides,
  });
}

describe('whisper transcriber', () => {
  it('says how to fix a missing model', async () => {
    await expect(transcriber({ modelPath: undefined }).transcribe(JOB)).rejects.toThrow(
      /POPY_WHISPER_MODEL/,
    );
  });

  it('refuses an empty recording', async () => {
    await expect(transcriber().transcribe({ ...JOB, audioBase64: '' })).rejects.toThrow(/empty/);
  });

  it('refuses a recording past the 25 MB cap', async () => {
    const huge = Buffer.alloc(26 * 1024 * 1024).toString('base64');
    await expect(transcriber().transcribe({ ...JOB, audioBase64: huge })).rejects.toThrow(
      /too large/,
    );
  });

  it('says how to fix a missing ffmpeg, in words', async () => {
    const error = await transcriber()
      .transcribe(JOB)
      .then(
        () => undefined,
        (cause: unknown) => cause,
      );

    expect(error).toBeInstanceOf(TranscriberError);
    expect((error as Error).message).toMatch(/ffmpeg/i);
  });
});
