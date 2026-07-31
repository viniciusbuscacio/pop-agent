import { describe, expect, it, vi } from 'vitest';
import { NpmUpdateChecker } from './npm-update-checker.js';

const versions = { popyVersion: '0.2.0', nodeVersion: 'v22.0.0', piVersion: '0.83.0' };

describe('NpmUpdateChecker', () => {
  it('reports the installed versions and the latest pi', async () => {
    const fetchLatest = vi.fn().mockResolvedValue('0.84.0');
    const checker = new NpmUpdateChecker({ versions, now: () => 0, fetchLatest });

    const status = await checker.status();
    expect(status.pi).toEqual({ current: '0.83.0', latest: '0.84.0' });
    expect(status.popy.current).toBe('0.2.0');
    expect(status.updateCommand).toContain('npm run gate');
  });

  it('leaves latest undefined when the check fails', async () => {
    const fetchLatest = vi.fn().mockRejectedValue(new Error('offline'));
    const checker = new NpmUpdateChecker({ versions, now: () => 0, fetchLatest });

    expect((await checker.status()).pi.latest).toBeUndefined();
  });

  it('caches the latest for an hour', async () => {
    const fetchLatest = vi.fn().mockResolvedValue('0.84.0');
    let now = 0;
    const checker = new NpmUpdateChecker({ versions, now: () => now, fetchLatest });

    await checker.status();
    now = 30 * 60 * 1000;
    await checker.status();
    expect(fetchLatest).toHaveBeenCalledTimes(1);

    now = 2 * 60 * 60 * 1000;
    await checker.status();
    expect(fetchLatest).toHaveBeenCalledTimes(2);
  });
});
