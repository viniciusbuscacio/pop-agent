import { describe, expect, it, vi } from 'vitest';
import { probeTailnetHttps, waitForTailnetHttps } from './https-readiness.js';

describe('HTTPS readiness retries', () => {
  it('waits through transient failures before reporting readiness', async () => {
    const probe = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValue(true);
    const pause = vi.fn(() => Promise.resolve());
    expect(await waitForTailnetHttps('https://pop.tail.ts.net', probe, pause)).toBe(true);
    expect(probe).toHaveBeenCalledTimes(3); expect(pause).toHaveBeenCalledTimes(2);
  });
  it('bounds retries and never claims a failed endpoint is ready', async () => {
    const probe = vi.fn(() => Promise.resolve(false));
    expect(await waitForTailnetHttps('https://pop.tail.ts.net', probe, () => Promise.resolve())).toBe(false);
    expect(probe).toHaveBeenCalledTimes(10);
  });
  it.each(['http://pop.tail.ts.net', 'https://example.com', 'https://user@pop.tail.ts.net', 'https://pop.tail.ts.net:444', 'not a URL'])('refuses untrusted destinations without network access: %s', async (url) => {
    expect(await probeTailnetHttps(url)).toBe(false);
  });
});
