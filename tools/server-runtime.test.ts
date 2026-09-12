import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateArchiveListing, validateManifest, prepareRuntimeSource, git, type RuntimeManifest } from './server-runtime.ts';

const expected = { version: '0.2.62', commit: 'a'.repeat(40), tree: 'b'.repeat(40), node: 'v22.23.2', architecture: 'amd64', glibc: '2.39' };
const manifest: RuntimeManifest = { schema: 1, ...expected, platform: 'linux', gateCompletedAt: '2026-09-05T00:00:00Z', file: 'pop-agent-0.2.62-linux-amd64.tar.gz', size: 1024, sha256: 'c'.repeat(64) };

describe('prebuilt server release trust boundary', () => {
  it('accepts only a matching release and a compatible glibc', () => {
    expect(validateManifest(manifest, expected)).toEqual(manifest);
    expect(validateManifest(manifest, { ...expected, glibc: '2.43' })).toEqual(manifest);
    expect(() => validateManifest(manifest, { ...expected, glibc: '2.35' })).toThrow('glibc');
  });
  it.each([
    { commit: 'd'.repeat(40) }, { tree: 'd'.repeat(40) }, { node: 'v24.0.0' },
    { architecture: 'arm64' }, { version: '0.2.61' }, { sha256: 'invalid' },
    { size: -1 }, { size: 2_000_000_001 }, { file: '../../anything' }, { gateCompletedAt: '' },
  ])('rejects mismatched or malformed metadata %j', (change) => {
    expect(() => validateManifest({ ...manifest, ...change }, expected)).toThrow();
  });
  it('accepts internal workspace and executable symlinks', () => {
    expect(() => validateArchiveListing(['node_modules/', 'node_modules/@pop-agent/server', 'server/dist/main.js'], [
      'd root node_modules/', 'l root node_modules/@pop-agent/server -> ../../server', '- root server/dist/main.js',
    ])).not.toThrow();
  });
  it.each([
    [['../../escape'], ['- root ../../escape']],
    [['server/src/main.ts'], ['- root server/src/main.ts']],
    [['node_modules/a'], ['l root node_modules/a -> /etc']],
    [['node_modules/a'], ['l root node_modules/a -> ../../etc']],
    [['node_modules/a', 'node_modules/a/b'], ['l root node_modules/a -> ../server', '- root node_modules/a/b']],
    [['node_modules/a'], ['h root node_modules/a link to ../secret']],
    [['node_modules/a', 'node_modules/a'], ['- root a', '- root a']],
    [['node_modules/a'], ['p root a']],
  ])('rejects archive traversal, writes through links, duplicates, and special entries', (names, verbose) => {
    expect(() => validateArchiveListing(names, verbose)).toThrow();
  });
});


describe('published release source selection', () => {
  it.each(['1.2.3', '1.2.4'])('pairs a published tag with shallow development version %s without changing the caller checkout', (developmentVersion) => {
    const root = mkdtempSync(join(tmpdir(), 'pop-release-source-'));
    try {
      const origin = join(root, 'origin'); mkdirSync(origin);
      git(origin, ['init', '--quiet']); git(origin, ['config', 'user.name', 'Test']); git(origin, ['config', 'user.email', 'test@example.invalid']);
      writeFileSync(join(origin, 'VERSION'), '1.2.3\n'); writeFileSync(join(origin, 'source.txt'), 'published');
      git(origin, ['add', '.']); git(origin, ['commit', '--quiet', '-m', 'release']);
      const published = git(origin, ['rev-parse', 'HEAD']); git(origin, ['tag', '-a', 'v1.2.3', '-m', 'release']);
      writeFileSync(join(origin, 'source.txt'), 'development'); writeFileSync(join(origin, 'VERSION'), developmentVersion + '\n'); git(origin, ['commit', '--quiet', '-am', 'next development']);
      const shallow = join(root, 'shallow'); git(root, ['clone', '--quiet', '--depth=1', '--no-tags', pathToFileURL(origin).href, shallow]);
      const main = git(shallow, ['rev-parse', 'HEAD']);
      const runtime = join(root, 'runtime');
      expect(prepareRuntimeSource(shallow, runtime, '1.2.3', pathToFileURL(origin).href).commit).toBe(published);
      expect(readFileSync(join(runtime, 'source.txt'), 'utf8')).toBe('published');
      expect(git(shallow, ['rev-parse', 'HEAD'])).toBe(main);
      expect(git(shallow, ['status', '--porcelain'])).toBe('');
      const offline = join(root, 'offline'); expect(prepareRuntimeSource(shallow, offline, developmentVersion).commit).toBe(main);
      expect(() => prepareRuntimeSource(shallow, join(root, 'missing'), '9.9.9', pathToFileURL(origin).href)).toThrow('published source tag');
    } finally { rmSync(root, {recursive:true,force:true}); }
  });
});
