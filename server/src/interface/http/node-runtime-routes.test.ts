import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createNodeRuntimeRoutes } from './node-runtime-routes.js';

describe.each([
  ['darwin-arm64', 'node-v22.23.2-darwin-arm64.tar.gz', 'application/gzip'],
  ['windows-amd64', 'node-v22.23.2-win-x64.zip', 'application/zip'],
])('managed Node runtime distribution (%s)', (target, file, contentType) => {
  let pack: string;
  const bytes = Buffer.from('official Node archive');

  beforeEach(() => {
    pack = mkdtempSync(join(tmpdir(), 'pop-node-runtime-'));
    const directory = join(pack, 'runtime', 'node');
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, file), bytes);
    writeFileSync(join(directory, 'manifest.json'), JSON.stringify({
      version: '22.23.2',
      minimumLauncherVersion: '1.1.0',
      packages: {
        [target]: {
          sourceUrl: `https://nodejs.org/dist/v22.23.2/${file}`,
          file,
          size: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        },
      },
    }));
  });

  afterEach(() => rmSync(pack, { recursive: true, force: true }));

  it('publishes a no-store manifest and immutable declared artifact', async () => {
    const routes = createNodeRuntimeRoutes({ cliPack: pack });
    const manifest = await routes.request('/runtime/node/manifest.json');
    expect(manifest.status).toBe(200);
    expect(manifest.headers.get('cache-control')).toBe('no-store');

    const archive = await routes.request(`/runtime/node/22.23.2/${file}`);
    expect(archive.status).toBe(200);
    expect(archive.headers.get('content-type')).toBe(contentType);
    expect(archive.headers.get('cache-control')).toContain('immutable');
    expect(Buffer.from(await archive.arrayBuffer())).toEqual(bytes);
  });

  it('serves only the version and filename declared by the manifest', async () => {
    const routes = createNodeRuntimeRoutes({ cliPack: pack });
    expect((await routes.request(`/runtime/node/22.23.1/${file}`)).status).toBe(404);
    expect((await routes.request('/runtime/node/22.23.2/node-v22.23.2-linux-x64.tar.gz')).status).toBe(404);
    expect((await routes.request('/runtime/node/22.23.2/..%2Fmanifest.json')).status).toBe(404);
  });

  it('refuses missing, malformed, and size-mismatched releases', async () => {
    const routes = createNodeRuntimeRoutes({ cliPack: pack });
    writeFileSync(join(pack, 'runtime', 'node', file), 'truncated');
    expect((await routes.request(`/runtime/node/22.23.2/${file}`)).status).toBe(404);

    writeFileSync(join(pack, 'runtime', 'node', 'manifest.json'), '{');
    expect((await routes.request('/runtime/node/manifest.json')).status).toBe(404);
  });
});
