import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDesktopDownloadRoutes } from './desktop-download-routes.js';

describe('Pop Desktop distribution', () => {
  let pack: string;
  const version = '0.2.11';
  const file = `pop-desktop-${version}-darwin-arm64.zip`;
  const routes = () => createDesktopDownloadRoutes({ desktopPack: pack, desktopReleaseVersion: version });

  beforeEach(() => {
    pack = mkdtempSync(join(tmpdir(), 'pop-desktop-pack-'));
    const payload = 'signed desktop bundle';
    writeFileSync(join(pack, file), payload);
    writeFileSync(
      join(pack, 'release.json'),
      JSON.stringify({
        version, platform: 'darwin', arch: 'arm64', file,
        sha256: createHash('sha256').update(payload).digest('hex'), size: payload.length,
      }),
    );
  });

  afterEach(() => rmSync(pack, { recursive: true, force: true }));

  it('publishes immutable metadata and serves only its exact package', async () => {
    const distribution = routes();
    const metadata = await distribution.request('/desktop/release');
    expect(metadata.status).toBe(200);
    expect(await metadata.json()).toEqual({
      version,
      platform: 'darwin',
      arch: 'arm64',
      sha256: createHash('sha256').update('signed desktop bundle').digest('hex'),
      size: 21,
      downloadPath: `/v1/desktop/package/${file}`,
    });

    const download = await distribution.request(`/desktop/package/${file}`);
    expect(download.status).toBe(200);
    expect(download.headers.get('cache-control')).toContain('immutable');
    expect(await download.text()).toBe('signed desktop bundle');
    expect((await distribution.request('/desktop/package/pop-desktop-0.0.9-darwin-arm64.zip')).status).toBe(404);
  });

  it('404s for an absent, malformed or mismatched release', async () => {
    rmSync(join(pack, file));
    expect((await routes().request('/desktop/release')).status).toBe(404);

    writeFileSync(join(pack, 'release.json'), JSON.stringify({
      version: '../bad', platform: 'darwin', arch: 'arm64', file, sha256: '0'.repeat(64), size: 1,
    }));
    expect((await routes().request('/desktop/release')).status).toBe(404);
  });

  it('refuses a desktop package from a different global release', async () => {
    const mismatched = createDesktopDownloadRoutes({
      desktopPack: pack,
      desktopReleaseVersion: '0.2.12',
    });
    expect((await mismatched.request('/desktop/release')).status).toBe(404);
    expect((await mismatched.request(`/desktop/package/${file}`)).status).toBe(404);
  });
});
