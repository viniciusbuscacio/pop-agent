import { describe, expect, it, vi } from 'vitest';
import { VoiceCleanup } from './voice-cleanup.js';

/**
 * Best-effort by contract (popy.spec §14): whatever goes wrong -- no provider,
 * a refusal, a timeout -- the raw transcript comes back, so voice never breaks
 * because the cleanup did. Since 07/08 the call goes through the service-model
 * resolver rather than a hard-wired gateway, so what a test scripts here is one
 * function: "the background completion".
 */

describe('VoiceCleanup', () => {
  it('returns the model-cleaned transcript', async () => {
    const cleanup = new VoiceCleanup({
      complete: () => Promise.resolve('Buy coffee tomorrow.'),
      enabled: () => true,
      model: () => 'kimi',
    });
    expect(await cleanup.clean('buy coffee tomorow')).toBe('Buy coffee tomorrow.');
  });

  it('passes the Settings override as the model, and nothing when it is empty', async () => {
    const complete = vi.fn().mockResolvedValue('Clean.');
    await new VoiceCleanup({ complete, enabled: () => true, model: () => 'kimi' }).clean('raw');
    expect(complete.mock.calls[0]?.[1]).toEqual({ model: 'kimi' });

    complete.mockClear();
    await new VoiceCleanup({ complete, enabled: () => true, model: () => '' }).clean('raw');
    // Empty means "whatever this provider's Service Model is" -- the resolver
    // decides, and the caller must not name a model on its behalf.
    expect(complete.mock.calls[0]?.[1]).toEqual({});
  });

  it('returns the raw text when no provider can serve it', async () => {
    const cleanup = new VoiceCleanup({
      complete: () => Promise.reject(new Error('No provider is configured.')),
      enabled: () => true,
      model: () => 'kimi',
    });
    expect(await cleanup.clean('raw text')).toBe('raw text');
  });

  it('returns the raw text when the model fails (best-effort)', async () => {
    const cleanup = new VoiceCleanup({
      complete: () => Promise.reject(new Error('down')),
      enabled: () => true,
      model: () => 'kimi',
    });
    expect(await cleanup.clean('raw text')).toBe('raw text');
  });

  it('returns the raw text untouched when the cleanup is disabled', async () => {
    const complete = vi.fn();
    const cleanup = new VoiceCleanup({ complete, enabled: () => false, model: () => 'kimi' });
    expect(await cleanup.clean('raw text')).toBe('raw text');
    expect(complete).not.toHaveBeenCalled();
  });

  it('does not call the model for an empty transcript', async () => {
    const complete = vi.fn();
    const cleanup = new VoiceCleanup({ complete, enabled: () => true, model: () => 'k' });
    expect(await cleanup.clean('   ')).toBe('');
    expect(complete).not.toHaveBeenCalled();
  });
});
