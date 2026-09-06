import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { checkNativeRuntime, extractRuntime, fileHash, git, glibcVersion, validateManifest } from './server-runtime.ts';
import { installPreparedCheckout, parseInstallArguments } from './install-systemd.ts';

import { installEvent } from './install-journal.ts';

installEvent('runtime-preflight', { node: process.version, architecture: process.arch });
const source = resolve(import.meta.dirname, '..');
const verifyOnly = process.argv.includes('--verify-only');
const options = parseInstallArguments(process.argv.slice(2).filter((arg) => arg !== '--verify-only'), source);
if (options === 'help') throw new Error('Use deploy/bootstrap-server.sh --help');
if (process.platform !== 'linux' || process.getuid?.() === 0 || !['x64', 'arm64'].includes(process.arch)) throw new Error('Prebuilt installation requires a non-root Linux amd64/arm64 owner');
if (statSync(source).uid !== process.getuid?.() || git(source, ['status', '--porcelain']) !== '') throw new Error('Installation requires a clean checkout owned by the invoking user');
const version = readFileSync(join(source, 'VERSION'), 'utf8').trim();
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid product version');
const architecture = process.arch === 'x64' ? 'amd64' : 'arm64';
const commit = git(source, ['rev-parse', 'HEAD']);
const tree = git(source, ['rev-parse', 'HEAD^{tree}']);
installEvent('release-identity', { version, commit, tree });
const base = join(process.env['XDG_DATA_HOME'] ?? join(homedir(), '.local/share'), 'pop-agent/server-releases');
mkdirSync(base, { recursive: true, mode: 0o700 });
if (!lstatSync(base).isDirectory() || statSync(base).uid !== process.getuid?.() || (statSync(base).mode & 0o077) !== 0) throw new Error('Server release directory must be owner-only and not a symlink');
const cache = join(base, 'downloads');
mkdirSync(cache, { mode: 0o700, recursive: true });
if (!lstatSync(cache).isDirectory() || statSync(cache).uid !== process.getuid?.() || (statSync(cache).mode & 0o077) !== 0) throw new Error('Unsafe server download cache');
const origin = git(source, ['remote', 'get-url', 'origin']);
const repo = /^(?:https:\/\/github\.com\/|git@github\.com:)([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(origin)?.[1];
const localRelease = process.env['POP_AGENT_SERVER_RELEASE_DIR'];
if (repo === undefined && localRelease === undefined) throw new Error('A GitHub origin is required for release downloads; use POP_AGENT_SERVER_RELEASE_DIR for a trusted offline release');
const staging = mkdtempSync(join(base, '.install-'));
let completed = false;
try {
  async function acquire(name: string, destination: string, maximumSize: number): Promise<void> {
    if (localRelease !== undefined) {
      const path = join(resolve(localRelease), name);
      if (!lstatSync(path).isFile() || statSync(path).size > maximumSize) throw new Error('Invalid local release asset');
      copyFileSync(path, destination);
      return;
    }
    const authenticated = spawnSync('gh', ['auth', 'status', '--hostname', 'github.com'], { stdio: 'ignore' }).status === 0;
    const result = authenticated
      ? spawnSync('gh', ['release', 'download', `v${version}`, '--repo', repo!, '--pattern', name, '--output', destination], { stdio: 'ignore', timeout: 600_000 })
      : spawnSync('curl', ['--fail', '--silent', '--show-error', '--location', '--proto', '=https', '--proto-redir', '=https', '--max-time', '600', '--max-filesize', String(maximumSize), '--output', destination, `https://github.com/${repo}/releases/download/v${version}/${name}`], { stdio: 'ignore', timeout: 610_000 });
    installEvent('asset-download', { exit_code: result.status ?? -1 });
    if (result.status !== 0 || !existsSync(destination) || statSync(destination).size > maximumSize) {
      throw new Error(`Could not download ${name}. This exact version needs a published server release. For private repositories, run gh auth login. No compilation fallback was started.`);
    }
  }
  const manifestName = `pop-agent-${version}-linux-${architecture}.json`;
  const manifestPath = join(staging, manifestName);
  console.log(`Fetching verified server release ${version} for Linux ${architecture}...`);
  installEvent('release-manifest');
  await acquire(manifestName, manifestPath, 1_048_576);
  const manifest = validateManifest(JSON.parse(readFileSync(manifestPath, 'utf8')), { version, commit, tree, node: process.version, architecture, glibc: glibcVersion() });
  const archive = join(cache, `${manifest.sha256}-${manifest.file}`);
  const verified = existsSync(archive) && lstatSync(archive).isFile() && statSync(archive).size === manifest.size && await fileHash(archive) === manifest.sha256;
  if (!verified) {
    const downloaded = join(staging, manifest.file);
    installEvent('release-download');
    await acquire(manifest.file, downloaded, manifest.size);
    if (statSync(downloaded).size !== manifest.size || await fileHash(downloaded) !== manifest.sha256) throw new Error('Server archive failed size/SHA-256 verification');
    renameSync(downloaded, archive);
  } else console.log('Reusing the verified cached server archive.');
  const runtime = join(staging, 'runtime');
  execFileSync('git', ['clone', '--quiet', '--no-hardlinks', '--no-checkout', '--', source, runtime], { stdio: 'pipe' });
  execFileSync('git', ['-C', runtime, 'checkout', '--quiet', '--detach', commit], { stdio: 'pipe' });
  if (repo !== undefined) execFileSync('git', ['-C', runtime, 'remote', 'set-url', 'origin', `https://github.com/${repo}.git`]);
  console.log('Extracting production dependencies and prebuilt clients...');
  installEvent('runtime-extract');
  extractRuntime(archive, runtime);
  console.log('Checking native libraries, SQLite, and packaged application files...');
  installEvent('runtime-verify');
  await checkNativeRuntime(runtime);
  installEvent('runtime-smoke');
  execFileSync(process.execPath, ['tools/smoke.ts', '--built'], { cwd: runtime, stdio: 'inherit', env: { ...process.env, NODE_ENV: 'production' } });
  if (git(runtime, ['rev-parse', 'HEAD']) !== commit || git(runtime, ['status', '--porcelain']) !== '') throw new Error('Staged runtime no longer matches its source commit');
  if (!verifyOnly) {
    // Stable generation path before writing systemd; the previous service stays untouched until this point.
    const activated = join(base, `${version}-${architecture}-${Date.now()}`);
    renameSync(runtime, activated);
    console.log('Installing the verified release as a systemd service (no npm install, build, or full test suite)...');
    const previousUnit = '/etc/systemd/system/pop-agent-service.service';
    const previousLauncher = '/usr/local/bin/popman';
    const hadPrevious = existsSync(previousUnit) && existsSync(previousLauncher);
    if (hadPrevious) {
      copyFileSync(previousUnit, join(staging, 'previous.service'));
      copyFileSync(previousLauncher, join(staging, 'previous-popman'));
    }
    try {
      installEvent('service-activate');
      await installPreparedCheckout({ ...options, checkout: activated, prebuilt: true });
    } catch (error) {
      if (hadPrevious) {
        installEvent('service-rollback');
        console.error('Activation failed; restoring the previous service and popman launcher.');
        execFileSync('sudo', ['--', 'install', '-o', 'root', '-g', 'root', '-m', '0644', join(staging, 'previous.service'), previousUnit], { stdio: 'inherit' });
        execFileSync('sudo', ['--', 'install', '-o', 'root', '-g', 'root', '-m', '0755', join(staging, 'previous-popman'), previousLauncher], { stdio: 'inherit' });
        execFileSync('sudo', ['--', 'systemctl', 'daemon-reload'], { stdio: 'inherit' });
        execFileSync('sudo', ['--', 'systemctl', 'restart', 'pop-agent-service.service'], { stdio: 'inherit' });
      }
      throw error;
    }
  } else console.log('Verified prebuilt installation without npm, Go, Python, or compilers.');
  installEvent('runtime-complete');
  completed = true;
} finally {
  rmSync(staging, { recursive: true, force: true });
  if (!completed) installEvent('runtime-failed');
  if (!completed) console.error('Installation did not complete. Verified downloads are retained for retry.');
}
