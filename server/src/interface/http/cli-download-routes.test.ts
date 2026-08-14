import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCliDownloadRoutes } from './cli-download-routes.js';

/**
 * The one public route npm can reach (docs/cli.md, Distribution). What is
 * worth testing is not that a file downloads, but that ONLY this server's
 * own version does: an old URL answering with the new tarball is the exact
 * mismatch the version in the filename exists to prevent, and npm would cache
 * the lie by URL.
 */
describe('cli download', () => {
  let pack: string;

  const routes = (popAgentVersion: string) =>
    createCliDownloadRoutes({ cliPack: pack, versions: { popAgentVersion } });

  beforeEach(() => {
    pack = mkdtempSync(join(tmpdir(), 'pop-pack-'));
    writeFileSync(join(pack, 'cli-0.2.0.tgz'), 'tarball');
    mkdirSync(join(pack, 'launcher'));
    writeFileSync(join(pack, 'launcher', 'pop-launcher-1.0.0-darwin-arm64'), 'launcher');
    writeFileSync(join(pack, 'launcher', 'manifest.json'), JSON.stringify({
      version: '1.0.0',
      artifacts: {
        'darwin-arm64': {
          file: 'pop-launcher-1.0.0-darwin-arm64',
          size: 8,
          sha256: createHash('sha256').update('launcher').digest('hex'),
        },
      },
    }));
  });

  afterEach(() => {
    rmSync(pack, { recursive: true, force: true });
  });

  it('publishes the exact immutable package metadata without caching the manifest', async () => {
    const response = await routes('0.2.0').request('/cli/manifest.json');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      version: '0.2.0',
      minimumNodeVersion: '22.19.0',
      minimumLauncherVersion: '1.0.0',
      package: {
        url: '/cli-0.2.0.tgz',
        size: 7,
        sha256: createHash('sha256').update('tarball').digest('hex'),
      },
    });
  });

  it('does not advertise a package that has not been built', async () => {
    expect((await routes('9.9.9').request('/cli/manifest.json')).status).toBe(404);
  });

  it('serves only launcher artifacts declared by the launcher manifest', async () => {
    const manifest = await routes('0.2.0').request('/cli/launcher/manifest.json');
    expect(manifest.status).toBe(200);
    expect(manifest.headers.get('cache-control')).toBe('no-store');

    const binary = await routes('0.2.0').request('/cli/launcher/pop-launcher-1.0.0-darwin-arm64');
    expect(binary.status).toBe(200);
    expect(binary.headers.get('cache-control')).toContain('immutable');
    expect(await binary.text()).toBe('launcher');

    expect((await routes('0.2.0').request('/cli/launcher/pop-launcher-9.9.9-darwin-arm64')).status).toBe(404);
  });

  it('redirects the stable latest alias to the exact current package without caching it', async () => {
    const response = await routes('0.2.0').request('/cli-latest.tgz', { redirect: 'manual' });
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('/cli-0.2.0.tgz');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('serves this server version, with no session', async () => {
    const response = await routes('0.2.0').request('/cli-0.2.0.tgz');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/gzip');
    expect(await response.text()).toBe('tarball');
  });

  it('refuses a version this server does not serve, even when the file is there', async () => {
    // The server has moved to 0.3.0; the 0.2.0 file is still on disk. Serving
    // it would pair a 0.2 client with a 0.3 server, which the handshake would
    // then have to refuse -- one step too late to be useful.
    writeFileSync(join(pack, 'cli-0.3.0.tgz'), 'newer');
    const response = await routes('0.3.0').request('/cli-0.2.0.tgz');
    expect(response.status).toBe(404);
  });

  it('404s when the server was never packed', async () => {
    // Reads as "no client to give you", which is true, rather than as a crash.
    const response = await routes('9.9.9').request('/cli-9.9.9.tgz');
    expect(response.status).toBe(404);
  });

  it('cannot be walked out of the pack directory', async () => {
    const response = await routes('0.2.0').request('/cli-..%2F..%2Fetc%2Fpasswd.tgz');
    expect(response.status).toBe(404);
  });

  it('marks the URL immutable, because the version is in the name', async () => {
    const response = await routes('0.2.0').request('/cli-0.2.0.tgz');
    expect(response.headers.get('cache-control')).toContain('immutable');
  });
});
