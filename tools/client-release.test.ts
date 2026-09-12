import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { clientInputs, stageClients, validateClientLock } from './client-release.ts';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true}); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'pop-client-pin-')); roots.push(root);
  const put = (file: string, text: string) => { mkdirSync(dirname(join(root, file)), {recursive: true}); writeFileSync(join(root, file), text); };
  const git = (...args: string[]) => execFileSync('git', args, {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
  git('init'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  put('cli/package.json', JSON.stringify({version: '1.0.0', dependencies: {ws: '1.0.0'}}));
  put('cli/src/version.ts', 'export const VERSION = "1.0.0";');
  put('shared/src/protocol.ts', 'export const minimum = 1;');
  put('local-access/tray/main.go', 'const trayVersion = "1.0.0"');
  put('package-lock.json', JSON.stringify({packages: {cli: {version: '1.0.0', dependencies: {ws: '1.0.0'}}, 'node_modules/ws': {version: '1.0.0', integrity: 'verified'}, 'node_modules/esbuild': {version: '1.0.0'}}}));
  const commit = () => { git('add', '.'); git('commit', '-qm', 'fixture'); };
  commit();
  return {root, put, git, commit};
}

describe('independent server release clients', () => {
  it('keeps clients valid across web/server changes but blocks protocol and native changes', () => {
    const f = fixture(); const before = clientInputs(f.root);
    f.put('web/src/viewer.ts', 'PDF fix'); f.put('server/src/viewer.ts', 'PDF endpoint'); f.commit();
    expect(clientInputs(f.root)).toBe(before);
    f.put('shared/src/protocol.ts', 'export const minimum = 2;'); f.commit();
    expect(clientInputs(f.root)).not.toBe(before);
  });
  it('ignores release labels but detects changes to actual client dependencies', () => {
    const f = fixture(); const before = clientInputs(f.root);
    f.put('cli/src/version.ts', 'export const VERSION = "1.0.1";');
    f.put('local-access/tray/main.go', 'const trayVersion = "1.0.1"'); f.commit();
    expect(clientInputs(f.root)).toBe(before);
    const lock = JSON.parse(readFileSync(join(f.root, 'package-lock.json'), 'utf8'));
    lock.packages['node_modules/ws'].integrity = 'changed';
    f.put('package-lock.json', JSON.stringify(lock)); f.commit();
    expect(clientInputs(f.root)).not.toBe(before);
  });
  it('does not rebuild clients for a dependency used only by the web', () => {
    const f = fixture(); const before = clientInputs(f.root);
    const lock = JSON.parse(readFileSync(join(f.root, 'package-lock.json'), 'utf8'));
    lock.packages['node_modules/pdfjs-dist'] = {version: '5.0.0'};
    f.put('package-lock.json', JSON.stringify(lock)); f.commit();
    expect(clientInputs(f.root)).toBe(before);
  });
  it('stages exact historic manifests and CLI without executing a compiler or fetching cached clients', async () => {
    const f = fixture(); const files: Record<string, {file: string; size: number; sha256: string}> = {};
    const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
    for (const name of ['package.json', 'cli-1.0.0.tgz', 'launcher/manifest.json', 'local-access/manifest.json', 'runtime/node/manifest.json']) {
      const bytes = Buffer.from(name === 'package.json' ? '{"version":"1.0.0"}' : name.endsWith('manifest.json') ? '{"artifacts":{}}' : `historic:${name}`);
      f.put(`snapshot/cli/pack/${name}`, bytes.toString());
      files[name] = {file: name.split('/').at(-1)!, size: bytes.length, sha256: digest(bytes)};
    }
    const archive = join(f.root, 'baseline.tar.gz');
    execFileSync('tar', ['-czf', archive, '-C', join(f.root, 'snapshot'), 'cli/pack']);
    const bytes = readFileSync(archive); const sha256 = digest(bytes);
    const lock = {schema: 1, source: {repository: 'owner/pop', version: '1.0.0', commit: f.git('rev-parse', 'HEAD'), tree: f.git('rev-parse', 'HEAD^{tree}'), verifiedAt: new Date().toISOString(), archive: {file: 'baseline.tar.gz', size: bytes.length, sha256}}, inputs: clientInputs(f.root), cliVersion: '1.0.0', files};
    f.put('release/clients.json', JSON.stringify(lock));
    f.put(`cache/${sha256}.tar.gz`, ''); writeFileSync(join(f.root, `cache/${sha256}.tar.gz`), bytes);
    await stageClients(f.root, join(f.root, 'cache'));
    expect(JSON.parse(readFileSync(join(f.root, 'cli/pack/client-downloads.json'), 'utf8')).schema).toBe(2);
    expect(readFileSync(join(f.root, 'cli/pack/cli-1.0.0.tgz'), 'utf8')).toBe('historic:cli-1.0.0.tgz');
    expect(() => validateClientLock({...lock, files: {...files, '../escape': files['package.json']}})).toThrow();
    f.put('shared/src/protocol.ts', 'incompatible'); f.commit();
    await expect(stageClients(f.root, join(f.root, 'cache'))).rejects.toThrow('Client or protocol inputs changed');
  });
});
