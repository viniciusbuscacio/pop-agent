import { describe, expect, it, vi } from 'vitest';
import type { CompletionRequest, ProviderGateway } from '../ports/provider-gateway.js';
import { VoiceCleanup } from './voice-cleanup.js';

function gateway(complete: (r: CompletionRequest) => Promise<string>): ProviderGateway {
  return { listModels: () => Promise.resolve([]), complete };
}

describe('VoiceCleanup', () => {
  it('returns the model-cleaned transcript', async () => {
    const cleanup = new VoiceCleanup({
      gateway: gateway(() => Promise.resolve('Buy coffee tomorrow.')),
      apiKey: () => 'sk',
      serviceModel: () => 'kimi',
    });
    expect(await cleanup.clean('buy coffee tomorow')).toBe('Buy coffee tomorrow.');
  });

  it('returns the raw text when there is no key', async () => {
    const complete = vi.fn();
    const cleanup = new VoiceCleanup({
      gateway: gateway(complete),
      apiKey: () => undefined,
      serviceModel: () => 'kimi',
    });
    expect(await cleanup.clean('raw text')).toBe('raw text');
    expect(complete).not.toHaveBeenCalled();
  });

  it('returns the raw text when the model fails (best-effort)', async () => {
    const cleanup = new VoiceCleanup({
      gateway: gateway(() => Promise.reject(new Error('down'))),
      apiKey: () => 'sk',
      serviceModel: () => 'kimi',
    });
    expect(await cleanup.clean('raw text')).toBe('raw text');
  });

  it('does not call the model for an empty transcript', async () => {
    const complete = vi.fn();
    const cleanup = new VoiceCleanup({ gateway: gateway(complete), apiKey: () => 'sk', serviceModel: () => 'k' });
    expect(await cleanup.clean('   ')).toBe('');
    expect(complete).not.toHaveBeenCalled();
  });
});
