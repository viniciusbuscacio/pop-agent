import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

interface Fixture {
  root: string;
  bundle: string;
  sha256: string;
  commit: string;
  destination: string;
  dataDir: string;
  workspace: string;
  handoffLog: string;
}

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'pop-local-bundle-test-'));
  roots.push(root);
  const repository = join(root, 'source');
  mkdirSync(join(repository, 'deploy'), { recursive: true });
  writeFileSync(join(repository, 'VERSION'), '1.2.3\n');
  writeFileSync(join(repository, 'package.json'), '{"version":"1.2.3"}\n');
  writeFileSync(join(repository, 'package-lock.json'), '{"version":"1.2.3"}\n');
  writeFileSync(join(repository, 'deploy/bootstrap-server.sh'), `#!/bin/sh
{
  printf 'args:'
  printf ' <%s>' "$@"
  printf '\n'
} > "$BUNDLE_TEST_HANDOFF_LOG"
`);
  chmodSync(join(repository, 'deploy/bootstrap-server.sh'), 0o755);
  execFileSync('git', ['init', '--quiet'], { cwd: repository });
  execFileSync('git', ['config', 'user.name', 'Bundle Test'], { cwd: repository });
  execFileSync('git', ['config', 'user.email', 'bundle@example.invalid'], { cwd: repository });
  execFileSync('git', ['add', '.'], { cwd: repository });
  execFileSync('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: repository });
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim();
  const bundle = join(root, `pop-agent-1.2.3-${commit}.bundle`);
  execFileSync('git', ['bundle', 'create', bundle, 'HEAD'], { cwd: repository });
  const sha256 = createHash('sha256').update(readFileSync(bundle)).digest('hex');
  return {
    root,
    bundle,
    sha256,
    commit,
    destination: join(root, 'installed/source'),
    dataDir: join(root, 'data'),
    workspace: join(root, 'workspace'),
    handoffLog: join(root, 'handoff.log'),
  };
}

function run(input: Fixture, overrides: Partial<{ bundle: string; sha256: string; commit: string }> = {}) {
  const script = resolve(import.meta.dirname, '../deploy/install-server-bundle.sh');
  return spawnSync(script, [
    '--bundle', overrides.bundle ?? input.bundle,
    '--sha256', overrides.sha256 ?? input.sha256,
    '--commit', overrides.commit ?? input.commit,
    '--destination', input.destination,
    '--data-dir', input.dataDir,
    '--workspace', input.workspace,
    '--port', '9123',
    '--prepare-only',
  ], {
    encoding: 'utf8',
    env: { ...process.env, BUNDLE_TEST_HANDOFF_LOG: input.handoffLog },
  });
}

describe('local server bundle acquisition', () => {
  it('verifies SHA and bundle, clones exactly the requested commit, then hands off', () => {
    const input = fixture();
    const result = run(input);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(`Acquired clean Pop Agent checkout at commit ${input.commit}.`);
    expect(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: input.destination, encoding: 'utf8' }).trim()).toBe(input.commit);
    expect(execFileSync('git', ['status', '--porcelain=v1'], { cwd: input.destination, encoding: 'utf8' })).toBe('');
    const handoff = readFileSync(input.handoffLog, 'utf8');
    expect(handoff).toContain(`<--checkout> <${input.destination}>`);
    expect(handoff).toContain(`<--data-dir> <${input.dataDir}>`);
    expect(handoff).toContain(`<--workspace> <${input.workspace}>`);
    expect(handoff).toContain('<--port> <9123> <--prepare-only>');
  });

  it('refuses corrupted bytes and a commit absent from the verified bundle', () => {
    const corrupted = fixture();
    writeFileSync(corrupted.bundle, Buffer.concat([readFileSync(corrupted.bundle), Buffer.from('corrupt')]));
    const corruptResult = run(corrupted);
    expect(corruptResult.status).not.toBe(0);
    expect(corruptResult.stderr).toContain('bundle SHA-256 mismatch');
    expect(existsSync(corrupted.destination)).toBe(false);

    const wrongCommit = fixture();
    const wrongResult = run(wrongCommit, { commit: 'a'.repeat(40) });
    expect(wrongResult.status).not.toBe(0);
    expect(wrongResult.stderr).toContain('expected commit is absent from bundle');
    expect(existsSync(wrongCommit.destination)).toBe(false);
  });

  it('refuses existing destinations, symlink bundles, and unsafe paths', () => {
    const existing = fixture();
    mkdirSync(existing.destination, { recursive: true });
    const existingResult = run(existing);
    expect(existingResult.status).not.toBe(0);
    expect(existingResult.stderr).toContain('destination already exists');

    const linked = fixture();
    const bundleLink = join(linked.root, 'bundle-link');
    symlinkSync(linked.bundle, bundleLink);
    const linkedResult = run(linked, { bundle: bundleLink });
    expect(linkedResult.status).not.toBe(0);
    expect(linkedResult.stderr).toContain('not a symlink');

    const unsafe = fixture();
    unsafe.destination = `${unsafe.root}/parent/../destination`;
    const unsafeResult = run(unsafe);
    expect(unsafeResult.status).not.toBe(0);
    expect(unsafeResult.stderr).toContain('unsafe path segment');
  });
});
