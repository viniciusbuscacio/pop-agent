import { describe, expect, it, vi } from 'vitest';
import { isNewerVersion, latestSemverTag, NpmUpdateChecker } from './npm-update-checker.js';

const versions = { popAgentVersion: '0.2.0', nodeVersion: 'v22.0.0', piVersion: '0.83.0' };

/** No test may reach the network or a git remote. */
function deps(overrides: Partial<ConstructorParameters<typeof NpmUpdateChecker>[0]> = {}) {
  return {
    versions,
    now: () => 0,
    fetchLatest: vi.fn().mockResolvedValue(undefined),
    fetchLatestTag: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('NpmUpdateChecker', () => {
  it('reports the installed versions and the latest pi', async () => {
    const checker = new NpmUpdateChecker(deps({ fetchLatest: vi.fn().mockResolvedValue('0.84.0') }));

    const status = await checker.status();
    expect(status.pi).toEqual({
      current: '0.83.0',
      recommended: '0.83.0',
      latest: '0.84.0',
    });
    expect(status.popAgent.current).toBe('0.2.0');
    expect(status.updateCommand).toContain('npm run gate');
  });

  it('reports the latest Pop Agent tag from the origin', async () => {
    const checker = new NpmUpdateChecker(deps({ fetchLatestTag: vi.fn().mockResolvedValue('0.3.0') }));

    expect((await checker.status()).popAgent).toEqual({ current: '0.2.0', latest: '0.3.0' });
  });

  it('leaves latest undefined when the checks fail', async () => {
    const checker = new NpmUpdateChecker(
      deps({
        fetchLatest: vi.fn().mockRejectedValue(new Error('offline')),
        fetchLatestTag: vi.fn().mockRejectedValue(new Error('offline')),
      }),
    );

    const status = await checker.status();
    expect(status.pi.latest).toBeUndefined();
    expect(status.popAgent.latest).toBeUndefined();
  });

  it('caches the latest for an hour', async () => {
    const fetchLatest = vi.fn().mockResolvedValue('0.84.0');
    const fetchLatestTag = vi.fn().mockResolvedValue('0.3.0');
    let now = 0;
    const checker = new NpmUpdateChecker(deps({ now: () => now, fetchLatest, fetchLatestTag }));

    await checker.status();
    now = 30 * 60 * 1000;
    await checker.status();
    expect(fetchLatest).toHaveBeenCalledTimes(1);
    expect(fetchLatestTag).toHaveBeenCalledTimes(1);

    now = 2 * 60 * 60 * 1000;
    await checker.status();
    expect(fetchLatest).toHaveBeenCalledTimes(2);
    expect(fetchLatestTag).toHaveBeenCalledTimes(2);
  });

  it('serves the environment versions from the injected reader, resolved once', async () => {
    const environment = vi.fn().mockResolvedValue([{ name: 'ffmpeg', version: '8.0.1' }]);
    const checker = new NpmUpdateChecker(deps({ environment }));

    expect((await checker.status()).environment).toEqual([{ name: 'ffmpeg', version: '8.0.1' }]);
    await checker.status();
    expect(environment).toHaveBeenCalledTimes(1);
  });
});

describe('latestSemverTag', () => {
  it('picks the numerically highest tag, not the lexically highest', () => {
    const output = [
      'aaa\trefs/tags/v0.2.0',
      'bbb\trefs/tags/v0.10.1',
      'ccc\trefs/tags/v0.9.3',
      'ddd\trefs/tags/v0.10.1^{}',
    ].join('\n');
    expect(latestSemverTag(output)).toBe('0.10.1');
  });

  it('returns undefined when no version tag exists', () => {
    expect(latestSemverTag('aaa\trefs/heads/main')).toBeUndefined();
  });
});

describe('isNewerVersion', () => {
  it('compares x.y.z numerically, with or without the v prefix', () => {
    expect(isNewerVersion('0.2.0', '0.3.0')).toBe(true);
    expect(isNewerVersion('0.2.0', 'v0.2.1')).toBe(true);
    expect(isNewerVersion('0.10.0', '0.9.9')).toBe(false);
    expect(isNewerVersion('0.2.0', '0.2.0')).toBe(false);
  });
});
