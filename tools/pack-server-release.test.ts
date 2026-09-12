import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { packServerRelease } from './pack-server-release.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixtureRepository(): { root: string; repository: string; output: string; commit: string } {
  const root = mkdtempSync(join(tmpdir(), 'pop-pack-server-test-'));
  roots.push(root);
  const repository = join(root, 'repository');
  const output = join(root, 'output');
  mkdirSync(repository);
  for (const relative of ['shared', 'server', 'web', 'cli', 'deploy']) mkdirSync(join(repository, relative));
  writeFileSync(join(repository, 'VERSION'), '1.2.3\n');
  for (const relative of ['package.json', 'shared/package.json', 'server/package.json', 'web/package.json', 'cli/package.json']) {
    writeFileSync(join(repository, relative), `${JSON.stringify({ name: relative, version: '1.2.3' }, undefined, 2)}\n`);
  }
  writeFileSync(join(repository, 'package-lock.json'), `${JSON.stringify({ name: 'pop-agent', version: '1.2.3' }, undefined, 2)}\n`);
  writeFileSync(join(repository, 'deploy/bootstrap-server.sh'), '#!/bin/sh\nexit 0\n');
  chmodSync(join(repository, 'deploy/bootstrap-server.sh'), 0o755);
  execFileSync('git', ['init', '--quiet'], { cwd: repository });
  execFileSync('git', ['config', 'user.name', 'Release Test'], { cwd: repository });
  execFileSync('git', ['config', 'user.email', 'release@example.invalid'], { cwd: repository });
  execFileSync('git', ['add', '.'], { cwd: repository });
  execFileSync('git', ['commit', '--quiet', '-m', 'fixture'], {
    cwd: repository,
    env: { ...process.env, GIT_AUTHOR_DATE: '2024-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2024-01-01T00:00:00Z' },
  });
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim();
  return { root, repository, output, commit };
}

describe('local server source release packager', () => {
  it('creates deterministic immutable bundle and SHA bytes for one clean commit', () => {
    const fixture = fixtureRepository();
    const first = packServerRelease({ repository: fixture.repository, outputDir: fixture.output });
    const names = readdirSync(first.releaseDirectory).sort();
    expect(names).toEqual([
      `pop-agent-1.2.3-${fixture.commit}.bundle`,
      `pop-agent-1.2.3-${fixture.commit}.bundle.sha256`,
    ]);
    expect(first.commit).toBe(fixture.commit);
    const bundle = readFileSync(first.bundlePath);
    expect(first.bundleSha256).toBe(createHash('sha256').update(bundle).digest('hex'));
    expect(readFileSync(first.sha256Path, 'utf8')).toBe(`${first.bundleSha256}  ${names[0]}\n`);
    execFileSync('git', ['-C', fixture.repository, 'bundle', 'verify', first.bundlePath]);

    const firstBytes = names.map((name) => readFileSync(join(first.releaseDirectory, name)));
    const second = packServerRelease({ repository: fixture.repository, outputDir: fixture.output });
    expect(second).toEqual(first);
    expect(names.map((name) => readFileSync(join(first.releaseDirectory, name)))).toEqual(firstBytes);

    writeFileSync(first.bundlePath, 'different bytes');
    expect(() => packServerRelease({ repository: fixture.repository, outputDir: fixture.output }))
      .toThrow(/refusing to overwrite versioned artifact with different bytes/u);
  });

  it('refuses dirty input and output inside the replaceable checkout', () => {
    const fixture = fixtureRepository();
    writeFileSync(join(fixture.repository, 'untracked'), 'not committed');
    expect(() => packServerRelease({ repository: fixture.repository, outputDir: fixture.output }))
      .toThrow(/worktree is not clean/u);
    rmSync(join(fixture.repository, 'untracked'));
    expect(() => packServerRelease({ repository: fixture.repository, outputDir: join(fixture.repository, 'release') }))
      .toThrow(/outside the source checkout/u);
  });

  it('prints the exact local bundle, SHA, commit, and version from the CLI', () => {
    const fixture = fixtureRepository();
    const script = join(import.meta.dirname, 'pack-server-release.ts');
    const result = spawnSync(process.execPath, ['--import', 'tsx', script,
      '--repository', fixture.repository,
      '--output-dir', fixture.output,
    ], { encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(`commit=${fixture.commit}\n`);
    expect(result.stdout).toContain('version=1.2.3\n');
    expect(result.stdout).toMatch(/sha256=[a-f0-9]{64}\n/u);
    expect(result.stdout).toMatch(/bundle=\/.*\.bundle\n/u);
  });
});
