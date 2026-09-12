import { createHash } from 'node:crypto';
import { chmodSync, cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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

function createFixture(options: { escapingNodeSymlink?: boolean; badNodeHash?: boolean; packagesInstalled?: boolean } = {}): Fixture {
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
    printf '\\nnode:%s\\ngo:%s\\nwhisper:%s\\n' "$(node --version)" "$(go version)" "$(whisper-cli --version)"
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
  const whisperRoot = join(source, 'whisper-bin-ubuntu-x64');
  mkdirSync(whisperRoot, { recursive: true });
  executable(join(whisperRoot, 'whisper-cli'), '#!/bin/sh\ncase "${1:-}" in --help) exit 0;; --version) printf "whisper.cpp fixture\\n";; *) exit 0;; esac\n');
  const whisperArchive = join(fixtures, 'whisper-bin-ubuntu-x64.tar.gz');
  archive(source, basename(nodeRoot), nodeArchive, 'xz');
  archive(source, basename(goRoot), goArchive, 'gzip');
  archive(source, basename(whisperRoot), whisperArchive, 'gzip');
  const nodeHash = options.badNodeHash === true ? '0'.repeat(64) : sha256(nodeArchive);
  writeFileSync(join(deploy, 'server-toolchain-manifest.tsv'), [
    `node|22.23.2|linux|amd64|${basename(nodeArchive)}|${String(readFileSync(nodeArchive).byteLength)}|${nodeHash}|https://fixtures.invalid/${basename(nodeArchive)}`,
    `go|1.24.12|linux|amd64|${basename(goArchive)}|${String(readFileSync(goArchive).byteLength)}|${sha256(goArchive)}|https://fixtures.invalid/${basename(goArchive)}`,
    `whisper|fixture|linux|amd64|${basename(whisperArchive)}|${String(readFileSync(whisperArchive).byteLength)}|${sha256(whisperArchive)}|https://fixtures.invalid/${basename(whisperArchive)}`,
    '',
  ].join('\n'));

  const curlLog = join(root, 'curl.log');
  const sudoLog = join(root, 'sudo.log');
  const npmLog = join(root, 'npm.log');
  const osRelease = join(root, 'os-release');
  writeFileSync(osRelease, 'ID=ubuntu\nVERSION_CODENAME=noble\n');
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
  executable(join(fakeBin, 'dpkg-query'), options.packagesInstalled === true ? '#!/bin/sh\nprintf "install ok installed"\n' : '#!/bin/sh\nexit 1\n');
  executable(join(fakeBin, 'ffmpeg'), '#!/bin/sh\nexit 0\n');
  executable(join(fakeBin, 'tailscale'), '#!/bin/sh\n[ "${1:-}" = version ] && printf "1.98.10\\n"\nexit 0\n');

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
      POP_AGENT_OS_RELEASE_FILE: osRelease,
    },
  };
}

function run(fixture: Fixture, extra: string[] = [], env: NodeJS.ProcessEnv = fixture.env) {
  return spawnSync(fixture.script, [
    '--build-from-source',
    '--checkout', fixture.checkout,
    '--toolchain-dir', fixture.toolchain,
    '--data-dir', fixture.dataDir,
    '--workspace', fixture.workspace,
    ...extra,
  ], { encoding: 'utf8', env });
}

describe('server toolchain bootstrap', () => {
  it('rejects normal ARM64 installation before installing packages or downloading artifacts', () => {
    const fixture = createFixture();
    const result = spawnSync(fixture.script, ['--install-apt-packages'], { encoding: 'utf8', env: { ...fixture.env, FAKE_UNAME_M: 'aarch64' } });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('ARM64 publication is paused');
    expect(() => readFileSync(fixture.sudoLog)).toThrow();
    expect(() => readFileSync(fixture.curlLog)).toThrow();
  });

  it.each(['1.2.3', '1.2.4'])('delegates development %s to the stable tagged bootstrap before reading runtime pins', (developmentVersion) => {
    const fixture = createFixture({ packagesInstalled: true });
    const release = join(fixture.root, 'release-origin');
    mkdirSync(join(release, 'deploy'), { recursive: true });
    const receipt = join(fixture.root, 'selected-arguments');
    const git = (cwd: string, ...args: string[]) => {
      const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
      if (result.status !== 0) throw new Error(result.stderr);
      return result.stdout.trim();
    };
    git(release, 'init', '--quiet');
    git(release, 'config', 'user.name', 'Fixture');
    git(release, 'config', 'user.email', 'fixture@example.invalid');
    writeFileSync(join(release, 'VERSION'), '1.2.3\n');
    executable(join(release, 'deploy/bootstrap-server.sh'), '#!/bin/sh\nprintf "%s\\n" "$@" > "$SELECTED_ARGUMENTS"\nprintf "published bootstrap ran\\n"\n');
    git(release, 'add', '.');
    git(release, 'commit', '--quiet', '-m', 'published');
    git(release, 'tag', '-a', 'v1.2.3', '-m', 'stable');
    git(fixture.checkout, 'init', '--quiet');
    git(fixture.checkout, 'config', 'user.name', 'Fixture');
    git(fixture.checkout, 'config', 'user.email', 'fixture@example.invalid');
    writeFileSync(join(fixture.checkout, 'VERSION'), `${developmentVersion}\n`);
    writeFileSync(join(fixture.checkout, 'deploy/server-toolchain-manifest.tsv'), 'unpublished runtime pins must not be read\n');
    git(fixture.checkout, 'add', '.');
    git(fixture.checkout, 'commit', '--quiet', '-m', 'development');
    git(fixture.checkout, 'remote', 'add', 'origin', 'https://github.com/fixture/pop-agent.git');
    const before = git(fixture.checkout, 'rev-parse', 'HEAD');
    const config = join(fixture.root, 'gitconfig');
    writeFileSync(config, `[url "file://${release}"]\n  insteadOf = https://github.com/fixture/pop-agent.git\n[protocol "file"]\n  allow = always\n`);
    executable(join(fixture.root, 'fake-bin/gh'), '#!/bin/sh\ncase "$1" in auth) exit 0;; api) [ "$2" = repos/fixture/pop-agent/releases/latest ] || exit 2; printf "v1.2.3\\n";; *) exit 2;; esac\n');
    const result = spawnSync(fixture.script, ['--checkout', fixture.checkout, '--toolchain-dir', fixture.toolchain,
      '--data-dir', fixture.dataDir, '--workspace', fixture.workspace, '--port', '9898', '--skip-network-onboarding'], {
      encoding: 'utf8', env: { ...fixture.env, GIT_CONFIG_GLOBAL: config, SELECTED_ARGUMENTS: receipt },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Selecting published release v1.2.3');
    expect(result.stdout).toContain('published bootstrap ran');
    expect(readFileSync(receipt, 'utf8')).toContain(`--toolchain-dir\n${fixture.toolchain}\n--data-dir\n${fixture.dataDir}\n--workspace\n${fixture.workspace}\n--port\n9898\n--skip-network-onboarding\n`);
    expect(() => readFileSync(fixture.curlLog)).toThrow();
    expect(git(fixture.checkout, 'rev-parse', 'HEAD')).toBe(before);
    expect(git(fixture.checkout, 'status', '--porcelain')).toBe('');
  });

  it('prepares only Node and Whisper and omits compiler packages on the default path', () => {
    const fixture = createFixture();
    const result = spawnSync(fixture.script, ['--checkout', fixture.checkout, '--toolchain-dir', fixture.toolchain, '--install-apt-packages', '--prepare-only'], { encoding: 'utf8', env: fixture.env });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('no Go or compiler required');
    expect(readFileSync(fixture.curlLog, 'utf8').trim().split('\n')).toHaveLength(2);
    expect(readFileSync(fixture.sudoLog, 'utf8')).not.toMatch(/build-essential|python3|ffmpeg|x11|wayland|sdl|fonts/i);
    expect(lstatSync(join(fixture.toolchain, 'current/node')).isSymbolicLink()).toBe(true);
    expect(lstatSync(join(fixture.toolchain, 'current/whisper')).isSymbolicLink()).toBe(true);
  });

  it('skips apt entirely when runtime prerequisites and Tailscale are already installed', () => {
    const fixture = createFixture({ packagesInstalled: true });
    const result = spawnSync(fixture.script, ['--checkout', fixture.checkout, '--toolchain-dir', fixture.toolchain, '--install-apt-packages', '--prepare-only'], { encoding: 'utf8', env: fixture.env });
    expect(result.status, result.stderr).toBe(0);
    expect(() => readFileSync(fixture.sudoLog)).toThrow();
  });

  it('installs from verified local fixtures, activates atomically, and preserves matching runtimes', () => {
    const fixture = createFixture();
    const first = run(fixture, ['--prepare-only']);
    expect(first.status, first.stderr).toBe(0);
    expect(first.stdout).toContain('Managed toolchain ready: Node 22.23.2, Go 1.24.12, and whisper.cpp fixture (amd64).');
    expect(first.stdout).toContain('systemd installation was not invoked');
    expect(readFileSync(fixture.curlLog, 'utf8').trim().split('\n')).toHaveLength(3);

    const nodeLink = join(fixture.toolchain, 'current/node');
    const goLink = join(fixture.toolchain, 'current/go');
    const whisperLink = join(fixture.toolchain, 'current/whisper');
    expect(lstatSync(nodeLink).isSymbolicLink()).toBe(true);
    expect(lstatSync(goLink).isSymbolicLink()).toBe(true);
    expect(lstatSync(whisperLink).isSymbolicLink()).toBe(true);
    expect(readlinkSync(nodeLink)).toMatch(/^\.\.\/runtimes\/node-22\.23\.2-amd64-/);

    const second = run(fixture, ['--prepare-only']);
    expect(second.status, second.stderr).toBe(0);
    expect(second.stdout).toContain('Preserving verified node 22.23.2 runtime.');
    expect(second.stdout).toContain('Preserving verified go 1.24.12 runtime.');
    expect(second.stdout).toContain('Preserving verified whisper fixture runtime.');
    expect(readFileSync(fixture.curlLog, 'utf8').trim().split('\n')).toHaveLength(3);

    const firstNodeTarget = readlinkSync(nodeLink);
    const nodeRelease = join(nodeLink, '.pop-toolchain-release');
    writeFileSync(nodeRelease, readFileSync(nodeRelease, 'utf8').replace('version=22.23.2', 'version=stale'));
    const repaired = run(fixture, ['--prepare-only']);
    expect(repaired.status, repaired.stderr).toBe(0);
    expect(repaired.stdout).toContain('Activated verified node 22.23.2');
    expect(readlinkSync(nodeLink)).not.toBe(firstNodeTarget);
    expect(readFileSync(fixture.curlLog, 'utf8').trim().split('\n')).toHaveLength(3);
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
    expect(log).toContain('whisper:whisper.cpp fixture');
  });

  it('runs apt only behind the explicit opt-in and limits sudo to that phase in prepare-only mode', () => {
    const fixture = createFixture();
    const result = run(fixture, ['--install-apt-packages', '--prepare-only']);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('wait up to 5 minutes for its package lock');
    expect(readFileSync(fixture.sudoLog, 'utf8').trim().split('\n')).toEqual([
      '-- env DEBIAN_FRONTEND=noninteractive apt-get update',
      '-- env DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=300 install -y --no-install-recommends ca-certificates curl git xz-utils tar libgomp1 libstdc++6 build-essential python3 ffmpeg',
    ]);
  });

  it('installs Tailscale from the pinned official apt key for guided setup', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../deploy/bootstrap-server.sh'), 'utf8');
    expect(source).toContain('https://pkgs.tailscale.com/stable/ubuntu/$DIST_CODENAME.noarmor.gpg');
    expect(source).toContain('3e03dacf222698c60b8e2f990b809ca1b3e104de127767864284e6c228f1fb39');
    expect(source).toContain('/usr/share/keyrings/tailscale-archive-keyring.gpg');
    expect(source).toContain('/etc/apt/sources.list.d/tailscale.list');
    expect(source).toContain('apt-get -o DPkg::Lock::Timeout=300 install -y --no-install-recommends tailscale');
    expect(source).toContain('systemctl enable --now tailscaled');
  });

  it('accepts the standard Ubuntu os-release symlink', () => {
    const fixture = createFixture();
    const osRelease = fixture.env.POP_AGENT_OS_RELEASE_FILE as string;
    const target = join(fixture.root, 'usr-lib-os-release');
    writeFileSync(target, 'ID=ubuntu\n');
    rmSync(osRelease);
    symlinkSync(target, osRelease);

    const result = run(fixture, ['--prepare-only']);
    expect(result.status, result.stderr).toBe(0);
  });

  it('refuses root, unsupported platforms, and an archive with an escaping symlink', () => {
    const rootFixture = createFixture();
    const rootResult = run(rootFixture, ['--prepare-only'], { ...rootFixture.env, FAKE_UID: '0' });
    expect(rootResult.status).not.toBe(0);
    expect(rootResult.stderr).toContain('refusing to run as root');

    const platformFixture = createFixture();
    const platformResult = run(platformFixture, ['--prepare-only'], { ...platformFixture.env, FAKE_UNAME_S: 'Darwin' });
    expect(platformResult.status).not.toBe(0);
    expect(platformResult.stderr).toContain('only Ubuntu Linux is supported');

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
  it('pins one official Node, Go, and whisper.cpp archive for each supported architecture', () => {
    const manifestPath = resolve(import.meta.dirname, '../deploy/server-toolchain-manifest.tsv');
    const rows = readFileSync(manifestPath, 'utf8').split('\n')
      .filter((line) => line !== '' && !line.startsWith('#'))
      .map((line) => line.split('|'));
    expect(rows).toHaveLength(6);
    expect(rows.map(([component, , os, arch]) => `${component}-${os}-${arch}`).sort()).toEqual([
      'go-linux-amd64', 'go-linux-arm64', 'node-linux-amd64', 'node-linux-arm64',
      'whisper-linux-amd64', 'whisper-linux-arm64',
    ]);
    for (const [component, version, os, arch, file, size, hash, url, extra] of rows) {
      expect(extra).toBeUndefined();
      expect(component).toMatch(/^(node|go|whisper)$/);
      expect(version).toMatch(component === 'whisper' ? /^b\d+$/ : /^\d+\.\d+\.\d+$/);
      expect(os).toBe('linux');
      expect(arch).toMatch(/^(amd64|arm64)$/);
      expect(file).toMatch(/^[A-Za-z0-9._-]+\.tar\.(xz|gz)$/);
      expect(Number(size)).toBeGreaterThan(1_000_000);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
      if (component === 'node') expect(url).toBe(`https://nodejs.org/dist/v${version}/${file}`);
      if (component === 'go') expect(url).toBe(`https://go.dev/dl/${file}`);
      if (component === 'whisper') expect(url).toBe(`https://github.com/ggml-org/whisper.cpp/releases/download/${version}/${file}`);
    }
    const packageJson = JSON.parse(readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8')) as { engines: { node: string } };
    const minimumNode = packageJson.engines.node.replace(/^>=/, '').split('.').map(Number);
    for (const [, version] of rows.filter(([component]) => component === 'node')) {
      const pinned = version!.split('.').map(Number);
      expect(pinned[0]! > minimumNode[0]! || (pinned[0] === minimumNode[0] && pinned[1]! >= minimumNode[1]!)).toBe(true);
    }
  });
});
