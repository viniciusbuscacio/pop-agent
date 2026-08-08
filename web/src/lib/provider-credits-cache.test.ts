import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  loadProviderCredits,
  resetProviderCreditsCacheForTests,
} from './provider-credits-cache';

describe('loadProviderCredits', () => {
  afterEach(() => {
    resetProviderCreditsCacheForTests();
    vi.restoreAllMocks();
  });

  it('fetches once and serves the cache on repeat', async () => {
    const fetch = vi.fn().mockResolvedValue({ remaining: 5, used: 1 });

    await expect(loadProviderCredits('openrouter', 1, fetch)).resolves.toEqual({
      remaining: 5,
      used: 1,
    });
    await expect(loadProviderCredits('openrouter', 1, fetch)).resolves.toEqual({
      remaining: 5,
      used: 1,
    });

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('caches a missing balance so 404 is not repeated', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('not_found'));

    await expect(loadProviderCredits('anthropic', 1, fetch)).resolves.toBeNull();
    await expect(loadProviderCredits('anthropic', 1, fetch)).resolves.toBeNull();

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('drops the cache when the provider list version changes', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({ remaining: 5, used: 1 })
      .mockResolvedValueOnce({ remaining: 3, used: 2 });

    await loadProviderCredits('openrouter', 1, fetch);
    await loadProviderCredits('openrouter', 2, fetch);

    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
