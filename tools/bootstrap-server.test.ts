import { createHash } from 'node:crypto';
import { chmodSync, cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

interface Fixture {
  root: string;
  script: string;
  checkout: string;
  toolchain: string;
  dataDir: string;
  workspace: string;
  env: NodeJS.ProcessEnv;
  curlLog: string;
  sudoLog: string;
  npmLog: string;
}

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function executable(path: string, content: string): void {
  writeFileSync(path, content, 'utf8');
  chmodSync(path, 0o755);
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function archive(sourceParent: string, rootName: string, destination: string, compression: 'xz' | 'gzip'): void {
  const flag = compression === 'xz' ? '-cJf' : '-czf';
  const result = spawnSync('tar', [flag, destination, '-C', sourceParent, rootName], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`fixture tar failed: ${result.stderr}`);
}

function createFixture(options: { escapingNodeSymlink?: boolean; badNodeHash?: boolean } = {}): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'pop-bootstrap-test-'));
  roots.push(root);
  const checkout = join(root, 'checkout');
  const deploy = join(checkout, 'deploy');
  const fakeBin = join(root, 'fake-bin');
  const fixtures = join(root, 'fixtures');
  const source = join(root, 'archive-source');
  mkdirSync(deploy, { recursive: true });
  mkdirSync(fakeBin);
  mkdirSync(fixtures);
  mkdirSync(source);
  writeFileSync(join(checkout, 'package.json'), '{}\n');
  writeFileSync(join(checkout, 'package-lock.json'), '{}\n');

  const script = join(deploy, 'bootstrap-server.sh');
  cpSync(resolve(import.meta.dirname, '../deploy/bootstrap-server.sh'), script);
  chmodSync(script, 0o755);

  const nodeRoot = join(source, 'node-v22.23.2-linux-x64');
  mkdirSync(join(nodeRoot, 'bin'), { recursive: true });
  executable(join(nodeRoot, 'bin/node'), '#!/bin/sh\nprintf "v22.23.2\\n"\n');
  executable(join(nodeRoot, 'bin/npm'), `#!/bin/sh
if [ "\${1:-}" = --version ]; then printf '10.9.0\\n'; exit 0; fi
{
  printf 'args:'
  printf ' <%s>' "$@"
  printf '\\nnode:%s\\ngo:%s\\n' "$(node --version)" "$(go version)"
} >> "$BOOTSTRAP_TEST_NPM_LOG"
`);
  if (options.escapingNodeSymlink === true) {
    executable(join(nodeRoot, 'outside'), '#!/bin/sh\nexit 0\n');
    // A link that resolves outside the extracted runtime must be rejected.
    const linkResult = spawnSync('ln', ['-s', '../../../../../../etc/passwd', join(nodeRoot, 'escape')]);
    if (linkResult.status !== 0) throw new Error('could not create symlink fixture');
  }

  const goRoot = join(source, 'go');
  mkdirSync(join(goRoot, 'bin'), { recursive: true });
  mkdirSync(join(goRoot, 'test'), { recursive: true });
  executable(join(goRoot, 'bin/go'), '#!/bin/sh\nprintf "go version go1.24.12 linux/amd64\\n"\n');
  writeFileSync(join(goRoot, 'test', 'Þfoo.go'), 'package testfixture\n');

  const nodeArchive = join(fixtures, 'node-v22.23.2-linux-x64.tar.xz');
  const goArchive = join(fixtures, 'go1.24.12.linux-amd64.tar.gz');
  archive(source, basename(nodeRoot), nodeArchive, 'xz');
  archive(source, basename(goRoot), goArchive, 'gzip');
  const nodeHash = options.badNodeHash === true ? '0'.repeat(64) : sha256(nodeArchive);
  writeFileSync(join(deploy, 'server-toolchain-manifest.tsv'), [
    `node|22.23.2|linux|amd64|${basename(nodeArchive)}|${String(readFileSync(nodeArchive).byteLength)}|${nodeHash}|https://fixtures.invalid/${basename(nodeArchive)}`,
    `go|1.24.12|linux|amd64|${basename(goArchive)}|${String(readFileSync(goArchive).byteLength)}|${sha256(goArchive)}|https://fixtures.invalid/${basename(goArchive)}`,
    '',
  ].join('\n'));

  const curlLog = join(root, 'curl.log');
  const sudoLog = join(root, 'sudo.log');
  const npmLog = join(root, 'npm.log');
  executable(join(fakeBin, 'curl'), `#!/bin/sh
output=
url=
while [ "$#" -gt 0 ]; do
  case $1 in
    --output) output=$2; shift 2 ;;
    https://*) url=$1; shift ;;
    *) shift ;;
  esac
done
[ -n "$output" ] && [ -n "$url" ] || exit 2
printf '%s\\n' "$url" >> "$BOOTSTRAP_TEST_CURL_LOG"
cp "$BOOTSTRAP_TEST_FIXTURES/\${url##*/}" "$output"
`);
  executable(join(fakeBin, 'uname'), '#!/bin/sh\ncase "$1" in -s) printf "%s\\n" "${FAKE_UNAME_S:-Linux}";; -m) printf "%s\\n" "${FAKE_UNAME_M:-x86_64}";; *) exit 2;; esac\n');
  executable(join(fakeBin, 'id'), '#!/bin/sh\n[ "$1" = -u ] || exit 2\nprintf "%s\\n" "${FAKE_UID:-1000}"\n');
  executable(join(fakeBin, 'sudo'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$BOOTSTRAP_TEST_SUDO_LOG"\nexit 0\n');

  return {
    root,
    script,
    checkout,
    toolchain: join(root, 'toolchain'),
    dataDir: join(root, 'data'),
    workspace: join(root, 'workspace'),
    curlLog,
    sudoLog,
    npmLog,
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
      HOME: join(root, 'home'),
      BOOTSTRAP_TEST_FIXTURES: fixtures,
      BOOTSTRAP_TEST_CURL_LOG: curlLog,
      BOOTSTRAP_TEST_SUDO_LOG: sudoLog,
      BOOTSTRAP_TEST_NPM_LOG: npmLog,
    },
  };
}

function run(fixture: Fixture, extra: string[] = [], env: NodeJS.ProcessEnv = fixture.env) {
  return spawnSync(fixture.script, [
    '--checkout', fixture.checkout,
    '--toolchain-dir', fixture.toolchain,
    '--data-dir', fixture.dataDir,
    '--workspace', fixture.workspace,
    ...extra,
  ], { encoding: 'utf8', env });
}

describe('server toolchain bootstrap', () => {
  it('installs from verified local fixtures, activates atomically, and preserves matching runtimes', () => {
    const fixture = createFixture();
    const first = run(fixture, ['--prepare-only']);
    expect(first.status, first.stderr).toBe(0);
    expect(first.stdout).toContain('Managed toolchain ready: Node 22.23.2 and Go 1.24.12 (amd64).');
    expect(first.stdout).toContain('systemd installation was not invoked');
    expect(readFileSync(fixture.curlLog, 'utf8').trim().split('\n')).toHaveLength(2);

    const nodeLink = join(fixture.toolchain, 'current/node');
    const goLink = join(fixture.toolchain, 'current/go');
    expect(lstatSync(nodeLink).isSymbolicLink()).toBe(true);
    expect(lstatSync(goLink).isSymbolicLink()).toBe(true);
    expect(readlinkSync(nodeLink)).toMatch(/^\.\.\/runtimes\/node-22\.23\.2-amd64-/);

    const second = run(fixture, ['--prepare-only']);
    expect(second.status, second.stderr).toBe(0);
    expect(second.stdout).toContain('Preserving verified node 22.23.2 runtime.');
    expect(second.stdout).toContain('Preserving verified go 1.24.12 runtime.');
    expect(readFileSync(fixture.curlLog, 'utf8').trim().split('\n')).toHaveLength(2);

    const firstNodeTarget = readlinkSync(nodeLink);
    const nodeRelease = join(nodeLink, '.pop-toolchain-release');
    writeFileSync(nodeRelease, readFileSync(nodeRelease, 'utf8').replace('version=22.23.2', 'version=stale'));
    const repaired = run(fixture, ['--prepare-only']);
    expect(repaired.status, repaired.stderr).toBe(0);
    expect(repaired.stdout).toContain('Activated verified node 22.23.2');
    expect(readlinkSync(nodeLink)).not.toBe(firstNodeTarget);
    expect(readFileSync(fixture.curlLog, 'utf8').trim().split('\n')).toHaveLength(2);
  });

  it('hands off explicit paths and port with managed npm, Node, and Go first on PATH', () => {
    const fixture = createFixture();
    const result = run(fixture, ['--port', '9123']);
    expect(result.status, result.stderr).toBe(0);
    const log = readFileSync(fixture.npmLog, 'utf8');
    expect(log).toContain('args: <run> <install:server> <--> <--data-dir>');
    expect(log).toContain(`<${fixture.dataDir}> <--workspace> <${fixture.workspace}> <--port> <9123>`);
    expect(log).toContain('node:v22.23.2');
    expect(log).toContain('go:go version go1.24.12 linux/amd64');
  });

  it('runs apt only behind the explicit opt-in and limits sudo to that phase in prepare-only mode', () => {
    const fixture = createFixture();
    const result = run(fixture, ['--install-apt-packages', '--prepare-only']);
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(fixture.sudoLog, 'utf8').trim().split('\n')).toEqual([
      '-- env DEBIAN_FRONTEND=noninteractive apt-get update',
      '-- env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates curl git xz-utils tar build-essential python3',
    ]);
  });

  it('refuses root, unsupported platforms, and an archive with an escaping symlink', () => {
    const rootFixture = createFixture();
    const rootResult = run(rootFixture, ['--prepare-only'], { ...rootFixture.env, FAKE_UID: '0' });
    expect(rootResult.status).not.toBe(0);
    expect(rootResult.stderr).toContain('refusing to run as root');

    const platformFixture = createFixture();
    const platformResult = run(platformFixture, ['--prepare-only'], { ...platformFixture.env, FAKE_UNAME_S: 'Darwin' });
    expect(platformResult.status).not.toBe(0);
    expect(platformResult.stderr).toContain('only Ubuntu/Debian Linux is supported');

    const archiveFixture = createFixture({ escapingNodeSymlink: true });
    const archiveResult = run(archiveFixture, ['--prepare-only']);
    expect(archiveResult.status).not.toBe(0);
    expect(archiveResult.stderr).toContain('symlink escaping its runtime root');
    expect(lstatSync(join(archiveFixture.toolchain, 'current')).isDirectory()).toBe(true);
  });

  it('refuses a download that does not match repository-pinned SHA-256 metadata', () => {
    const fixture = createFixture({ badNodeHash: true });
    const result = run(fixture, ['--prepare-only']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('failed pinned size/SHA-256 verification');
    expect(() => lstatSync(join(fixture.toolchain, 'current/node'))).toThrow();
  });
});

describe('server toolchain release metadata', () => {
  it('pins one official Node and Go archive for each supported architecture', () => {
    const manifestPath = resolve(import.meta.dirname, '../deploy/server-toolchain-manifest.tsv');
    const rows = readFileSync(manifestPath, 'utf8').split('\n')
      .filter((line) => line !== '' && !line.startsWith('#'))
      .map((line) => line.split('|'));
    expect(rows).toHaveLength(4);
    expect(rows.map(([component, , os, arch]) => `${component}-${os}-${arch}`).sort()).toEqual([
      'go-linux-amd64', 'go-linux-arm64', 'node-linux-amd64', 'node-linux-arm64',
    ]);
    for (const [component, version, os, arch, file, size, hash, url, extra] of rows) {
      expect(extra).toBeUndefined();
      expect(component).toMatch(/^(node|go)$/);
      expect(version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(os).toBe('linux');
      expect(arch).toMatch(/^(amd64|arm64)$/);
      expect(file).toMatch(/^[A-Za-z0-9._-]+\.tar\.(xz|gz)$/);
      expect(Number(size)).toBeGreaterThan(1_000_000);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
      expect(url).toBe(`${component === 'node' ? `https://nodejs.org/dist/v${version}` : 'https://go.dev/dl'}/${file}`);
    }
    const packageJson = JSON.parse(readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8')) as { engines: { node: string } };
    const minimumNode = packageJson.engines.node.replace(/^>=/, '').split('.').map(Number);
    for (const [, version] of rows.filter(([component]) => component === 'node')) {
      const pinned = version!.split('.').map(Number);
      expect(pinned[0]! > minimumNode[0]! || (pinned[0] === minimumNode[0] && pinned[1]! >= minimumNode[1]!)).toBe(true);
    }
  });
});
