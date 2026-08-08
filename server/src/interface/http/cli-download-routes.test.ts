import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
  });

  afterEach(() => {
    rmSync(pack, { recursive: true, force: true });
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
