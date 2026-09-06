import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LazyClientArtifacts, type ClientArtifactDownloader } from './lazy-client-artifacts.js';
import { createNodeRuntimeRoutes } from '../../interface/http/node-runtime-routes.js';
import { createCliDownloadRoutes } from '../../interface/http/cli-download-routes.js';
import { createCliInstallerRoutes } from '../../interface/http/cli-installer-routes.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture(category: 'node' | 'launcher' | 'local-access' = 'node', target = 'windows-amd64') {
  const root = mkdtempSync(join(tmpdir(), 'pop-client-cache-')); roots.push(root);
  const pack = join(root, 'pack'); const cache = join(root, 'cache');
  const directory = join(pack, category === 'node' ? 'runtime/node' : category);
  mkdirSync(directory, { recursive: true });
  const bytes = Buffer.from('verified platform binary');
  const file = category === 'node' ? `node-v22.23.2-${target}.tar.gz`
    : category === 'launcher' ? `pop-launcher-1.1.5-${target}` : `pop-local-access-0.2.63-${target}.exe`;
  const artifact = { file, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), sourceUrl: `https://nodejs.org/dist/v22.23.2/${file}` };
  writeFileSync(join(directory, 'manifest.json'), JSON.stringify({ version: '22.23.2', minimumLauncherVersion: '1.1.5', [category === 'node' ? 'packages' : 'artifacts']: { [target]: artifact } }));
  writeFileSync(join(pack, 'client-downloads.json'), JSON.stringify({ repository: 'owner/private-pop', version: '0.2.63' }));
  let calls = 0; let corrupt = false;
  const downloader: ClientArtifactDownloader = { async download(found, source, requested, destination) {
    calls++; expect(found.file).toBe(file); expect(requested).toBe(category);
    if (category !== 'node') expect(source?.repository).toBe('owner/private-pop');
    await new Promise((resolve) => setTimeout(resolve, 5));
    writeFileSync(destination, corrupt ? 'bad' : bytes);
  } };
  const provider = new LazyClientArtifacts(pack, cache, downloader);
  return { root, pack, cache, directory, bytes, file, artifact, provider, calls: () => calls, corrupt: () => { corrupt = true; } };
}

describe('lazy verified client downloads', () => {
  it.each(['windows-amd64', 'linux-amd64', 'linux-arm64', 'darwin-amd64', 'darwin-arm64'])('serves %s on demand and reuses verified bytes', async (target) => {
    const f = fixture('node', target);
    const routes = createNodeRuntimeRoutes({ cliPack: f.pack, clientArtifacts: f.provider });
    expect(f.calls()).toBe(0);
    expect((await routes.request('/runtime/node/manifest.json')).status).toBe(200);
    expect(f.calls()).toBe(0);
    const url = `/runtime/node/22.23.2/${f.file}`;
    const responses = await Promise.all([routes.request(url), routes.request(url)]);
    for (const response of responses) { expect(response.status).toBe(200); expect(Buffer.from(await response.arrayBuffer())).toEqual(f.bytes); }
    expect(f.calls()).toBe(1);
    expect((await routes.request(url)).status).toBe(200); expect(f.calls()).toBe(1);
  });
  it.each(['launcher', 'local-access'] as const)('serves private-release %s bytes through the existing route', async (category) => {
    const f = fixture(category);
    const deps = { cliPack: f.pack, clientArtifacts: f.provider, versions: { popAgentVersion: '0.2.63' } };
    const routes = category === 'launcher' ? createCliDownloadRoutes(deps) : createCliInstallerRoutes(deps);
    const response = await routes.request(`${category === 'launcher' ? '/cli/launcher' : '/local-access'}/${f.file}`);
    expect(response.status).toBe(200); expect(Buffer.from(await response.arrayBuffer())).toEqual(f.bytes); expect(f.calls()).toBe(1);
  });
  it('never downloads undeclared files or injected Node source URLs', async () => {
    const f = fixture();
    expect(await f.provider.ensure('node', '../secret')).toBeUndefined();
    expect(await f.provider.ensure('node', 'unknown')).toBeUndefined();
    writeFileSync(join(f.directory, 'manifest.json'), JSON.stringify({ version: '22.23.2', packages: { target: { ...f.artifact, sourceUrl: 'http://127.0.0.1/secret' } } }));
    expect(await f.provider.ensure('node', f.file)).toBeUndefined(); expect(f.calls()).toBe(0);
  });
  it('does not publish corrupt downloads and reports retryable failure', async () => {
    const f = fixture(); f.corrupt();
    const routes = createNodeRuntimeRoutes({ cliPack: f.pack, clientArtifacts: f.provider });
    expect((await routes.request(`/runtime/node/22.23.2/${f.file}`)).status).toBe(503);
    expect(readdirSync(f.cache)).toEqual([]);
  });
  it('rechecks cached bytes and repairs corruption instead of serving it', async () => {
    const f = fixture(); const path = await f.provider.ensure('node', f.file);
    expect(path).toBeDefined(); writeFileSync(path!, Buffer.alloc(f.bytes.length));
    const repaired = await f.provider.ensure('node', f.file);
    expect(f.calls()).toBe(2); expect(readFileSync(repaired!)).toEqual(f.bytes);
  });
});
