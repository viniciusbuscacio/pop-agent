import { describe, expect, it } from 'vitest';
import { DEFAULT_WHISPER_MODEL, WHISPER_MODELS, WhisperModelStore, WhisperModelError } from './whisper-models.js';

describe('WhisperModelStore manifest', () => {
  it('defaults to medium and lists it', () => {
    expect(DEFAULT_WHISPER_MODEL).toBe('medium');
    expect(WHISPER_MODELS.some((m) => m.name === 'medium')).toBe(true);
  });

  it('pins a sha1 for every model', () => {
    for (const model of WHISPER_MODELS) {
      expect(model.sha1).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  it('rejects an unknown model name', async () => {
    const store = new WhisperModelStore('/tmp/popy-voice-models-test');
    await expect(store.ensure('nonexistent')).rejects.toThrow(WhisperModelError);
  });
});
