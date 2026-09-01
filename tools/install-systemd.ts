#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const MINIMUM_NODE = [22, 19, 0] as const;
const MINIMUM_GO = [1, 23, 0] as const;
const UNIT_NAME = 'pop-agent-service.service';
const UNIT_DESTINATION = `/etc/systemd/system/${UNIT_NAME}`;
const SAFE_PATH = /^\/[A-Za-z0-9._+@/-]+$/;
const SAFE_USER = /^[a-z_][a-z0-9_-]*\$?$/;

export interface InstallOptions {
  checkout: string;
  dataDir: string;
  workspace: string;
  port: number;
}

interface RunOptions {
  cwd: string;
  inherit?: boolean;
}

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

export interface CommandRunner {
  run(command: string, args: readonly string[], options: RunOptions): RunResult;
}

export interface InstallerDependencies {
  runner: CommandRunner;
  platform: NodeJS.Platform;
  uid: number;
  username: string;
  nodeVersion: string;
  nodeExecutable: string;
  goExecutable: string;
  whisperExecutable: string;
  systemdRuntimeDir: string;
  healthCheck: (url: string, timeoutMs: number) => Promise<boolean>;
}

const defaultRunner: CommandRunner = {
  run(command, args, options) {
    const result = spawnSync(command, args, {
      cwd: options.cwd,
      encoding: 'utf8',
      stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    });
    if (result.error) {
      return { status: 127, stdout: '', stderr: result.error.message };
    }
    return {
      status: result.status ?? 1,
      stdout: options.inherit ? '' : (result.stdout ?? ''),
      stderr: options.inherit ? '' : (result.stderr ?? ''),
    };
  },
};

function defaultDependencies(): InstallerDependencies {
  return {
    runner: defaultRunner,
    platform: process.platform,
    uid: process.getuid?.() ?? -1,
    username: userInfo().username,
    nodeVersion: process.versions.node,
    nodeExecutable: realpathSync(process.execPath),
    goExecutable: executableOnPath('go'),
    whisperExecutable: executableOnPath('whisper-cli'),
    systemdRuntimeDir: '/run/systemd/system',
    healthCheck: boundedHealthCheck,
  };
}

export function renderSystemdUnit(
  options: InstallOptions,
  username: string,
  nodeExecutable: string,
  goExecutable: string,
  whisperExecutable: string,
): string {
  const checkout = safeAbsolutePath('checkout', options.checkout);
  const dataDir = safeAbsolutePath('data directory', options.dataDir);
  const workspace = safeAbsolutePath('workspace', options.workspace);
  const node = safeAbsolutePath('Node executable', nodeExecutable);
  const go = safeAbsolutePath('Go executable', goExecutable);
  const whisper = safeAbsolutePath('whisper.cpp executable', whisperExecutable);
  validateUsername(username);
  validatePort(options.port);

  const pathDirectories = [
    dirname(node),
    dirname(go),
    dirname(whisper),
    '/usr/local/sbin',
    '/usr/local/bin',
    '/usr/sbin',
    '/usr/bin',
    '/sbin',
    '/bin',
  ];
  const servicePath = [...new Set(pathDirectories)].join(':');

  return [
    '[Unit]',
    'Description=Pop Agent server',
    'After=network-online.target',
    'Wants=network-online.target',
    'StartLimitIntervalSec=60',
    'StartLimitBurst=5',
    '',
    '[Service]',
    'Type=simple',
    `User=${username}`,
    `WorkingDirectory=${checkout}`,
    'Environment=NODE_ENV=production',
    `Environment=PATH=${servicePath}`,
    'Environment=PI_OFFLINE=1',
    'Environment=POP_AGENT_BIND=127.0.0.1',
    `Environment=POP_AGENT_PORT=${String(options.port)}`,
    `Environment=POP_AGENT_DATA_DIR=${dataDir}`,
    `Environment=POP_AGENT_WORKSPACE=${workspace}`,
    `ExecStart=${node} ${checkout}/server/dist/main.js`,
    'Restart=on-failure',
    'RestartSec=5s',
    'TimeoutStopSec=90s',
    'UMask=0077',
    'SyslogIdentifier=pop-agent-service',
    '',
    '[Install]',
    'WantedBy=multi-user.target',
    '',
  ].join('\n');
}

export function parseInstallArguments(args: readonly string[], checkout: string): InstallOptions | 'help' {
  let dataDir: string | undefined;
  let workspace: string | undefined;
  let port = 8787;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') return 'help';
    const value = args[index + 1];
    if (argument === '--data-dir' || argument === '--workspace' || argument === '--port') {
      if (value === undefined || value.startsWith('--')) throw new Error(`${argument} requires a value`);
      index += 1;
      if (argument === '--data-dir') dataDir = value;
      if (argument === '--workspace') workspace = value;
      if (argument === '--port') port = Number(value);
      continue;
    }
    throw new Error(`unknown argument: ${argument ?? ''}`);
  }

  if (dataDir === undefined || workspace === undefined) {
    throw new Error('both --data-dir and --workspace are required absolute paths outside the checkout');
  }

  return {
    checkout: safeAbsolutePath('checkout', checkout),
    dataDir: safeAbsolutePath('data directory', dataDir),
    workspace: safeAbsolutePath('workspace', workspace),
    port: validatePort(port),
  };
}

export async function installPreparedCheckout(
  requested: InstallOptions,
  dependencies: InstallerDependencies = defaultDependencies(),
): Promise<void> {
  const options = validatePreflight(requested, dependencies);
  const { runner } = dependencies;

  console.log('Installing locked dependencies as the checkout owner...');
  runChecked(runner, 'npm', ['ci'], options.checkout, true);

  console.log('Running the mandatory repository gate as the checkout owner...');
  runChecked(runner, 'npm', ['run', 'gate'], options.checkout, true);

  requireCleanCheckout(runner, options.checkout, 'The gate completed but the checkout is no longer clean. Commit or remove the changes and rerun the installer.');
  const builtServer = join(options.checkout, 'server/dist/main.js');
  if (!existsSync(builtServer) || !statSync(builtServer).isFile()) {
    throw new Error(`the gate did not produce ${builtServer}; inspect the gate output and rerun`);
  }

  const dataDir = prepareOwnedDirectory(options.dataDir, dependencies.uid, 'data directory');
  const workspace = prepareOwnedDirectory(options.workspace, dependencies.uid, 'workspace');
  const backupsDir = prepareOwnedDirectory(join(dirname(dataDir), 'pop-backups'), dependencies.uid, 'backup directory');
  ensureOutsideCheckout(options.checkout, dataDir, 'data directory');
  ensureOutsideCheckout(options.checkout, workspace, 'workspace');
  ensureOutsideCheckout(options.checkout, backupsDir, 'backup directory');
  ensureSeparateDirectories(dataDir, workspace);
  ensureSeparateDirectories(backupsDir, workspace);

  const finalOptions = { ...options, dataDir, workspace };
  const unit = renderSystemdUnit(
    finalOptions,
    dependencies.username,
    dependencies.nodeExecutable,
    dependencies.goExecutable,
    dependencies.whisperExecutable,
  );
  const stagingDirectory = mkdtempSync(join(tmpdir(), 'pop-agent-systemd-'));
  const stagedUnit = join(stagingDirectory, UNIT_NAME);

  try {
    writeFileSync(stagedUnit, unit, { encoding: 'utf8', mode: 0o600 });
    console.log(`Installing ${UNIT_NAME} through narrowly scoped sudo commands...`);
    runChecked(runner, 'sudo', ['--', 'install', '-o', 'root', '-g', 'root', '-m', '0644', stagedUnit, UNIT_DESTINATION], options.checkout, true);
    runChecked(runner, 'sudo', ['--', 'systemctl', 'daemon-reload'], options.checkout, true);
    runChecked(runner, 'sudo', ['--', 'systemctl', 'enable', UNIT_NAME], options.checkout, true);
    runChecked(runner, 'sudo', ['--', 'systemctl', 'restart', UNIT_NAME], options.checkout, true);
  } finally {
    rmSync(stagingDirectory, { recursive: true, force: true });
  }

  const healthUrl = `http://127.0.0.1:${String(options.port)}/healthz`;
  console.log(`Waiting up to 30 seconds for ${healthUrl}...`);
  if (!(await dependencies.healthCheck(healthUrl, 30_000))) {
    throw new Error(
      `service installation completed, but ${healthUrl} did not become healthy within 30 seconds; run `
      + `"sudo systemctl status ${UNIT_NAME}" and "sudo journalctl -u ${UNIT_NAME} -n 100 --no-pager"`,
    );
  }
  runChecked(runner, 'systemctl', ['is-active', '--quiet', UNIT_NAME], options.checkout);
  console.log(`Pop Agent is healthy. The service remains loopback-only at http://127.0.0.1:${String(options.port)}.`);
}

function executableOnPath(name: string): string {
  for (const directory of (process.env['PATH'] ?? '').split(':')) {
    if (!isAbsolute(directory)) continue;
    const candidate = join(directory, name);
    try {
      accessSync(candidate, constants.X_OK);
      if (statSync(candidate).isFile()) return realpathSync(candidate);
    } catch {
      // Keep looking through the explicit absolute PATH entries.
    }
  }
  throw new Error(`required command not found on PATH: ${name}`);
}

function validatePreflight(requested: InstallOptions, dependencies: InstallerDependencies): InstallOptions {
  if (dependencies.platform !== 'linux') throw new Error('server service installation is supported only on Linux with systemd');
  if (dependencies.uid < 0) throw new Error('could not determine the current Unix user ID');
  if (dependencies.uid === 0) {
    throw new Error('do not run this installer as root; run it as the non-root checkout owner and allow only its explicit sudo prompts');
  }
  validateUsername(dependencies.username);
  requireVersion('Node', dependencies.nodeVersion, MINIMUM_NODE);
  safeAbsolutePath('Go executable', dependencies.goExecutable);
  safeAbsolutePath('whisper.cpp executable', dependencies.whisperExecutable);

  const checkout = realpathSync(safeAbsolutePath('checkout', requested.checkout));
  const checkoutStat = statSync(checkout);
  if (!checkoutStat.isDirectory()) throw new Error(`checkout is not a directory: ${checkout}`);
  if (checkoutStat.uid !== dependencies.uid) {
    throw new Error(`checkout must be owned by the current non-root user (${dependencies.username}): ${checkout}`);
  }
  if (!existsSync(join(checkout, 'package.json')) || !existsSync(join(checkout, 'package-lock.json'))) {
    throw new Error(`checkout is not a prepared Pop Agent repository: ${checkout}`);
  }
  if (!existsSync(dependencies.systemdRuntimeDir) || !statSync(dependencies.systemdRuntimeDir).isDirectory()) {
    throw new Error('systemd is not running: /run/systemd/system is unavailable');
  }

  const dataDir = canonicalProspectivePath('data directory', requested.dataDir);
  const workspace = canonicalProspectivePath('workspace', requested.workspace);
  validatePort(requested.port);
  ensureOutsideCheckout(checkout, dataDir, 'data directory');
  ensureOutsideCheckout(checkout, workspace, 'workspace');
  ensureSeparateDirectories(dataDir, workspace);

  const { runner } = dependencies;
  const gitVersion = runChecked(runner, 'git', ['--version'], checkout).stdout.trim();
  if (!/^git version \d+\./.test(gitVersion)) throw new Error(`could not validate Git: ${gitVersion || 'no version output'}`);
  const npmVersion = runChecked(runner, 'npm', ['--version'], checkout).stdout.trim();
  if (!/^\d+\.\d+\.\d+/.test(npmVersion)) throw new Error(`could not validate npm: ${npmVersion || 'no version output'}`);
  const goVersion = runChecked(runner, 'go', ['version'], checkout).stdout;
  const goMatch = /\bgo(\d+\.\d+(?:\.\d+)?)/.exec(goVersion);
  if (goMatch?.[1] === undefined) throw new Error(`could not parse Go version from: ${goVersion.trim() || 'no version output'}`);
  requireVersion('Go', goMatch[1], MINIMUM_GO);
  runChecked(runner, 'systemctl', ['--version'], checkout);
  runChecked(runner, 'sudo', ['--version'], checkout);
  runChecked(runner, 'install', ['--version'], checkout);

  const repositoryRoot = realpathSync(runChecked(runner, 'git', ['rev-parse', '--show-toplevel'], checkout).stdout.trim());
  if (repositoryRoot !== checkout) throw new Error(`installer must run from the repository root; Git reports ${repositoryRoot}`);
  requireCleanCheckout(runner, checkout, 'checkout is not clean; commit or remove staged, unstaged, and untracked files before installation');

  return { ...requested, checkout, dataDir, workspace };
}

function requireCleanCheckout(runner: CommandRunner, checkout: string, message: string): void {
  const status = runChecked(runner, 'git', ['status', '--porcelain=v1', '--untracked-files=normal'], checkout).stdout;
  if (status.trim() !== '') throw new Error(message);
}

function canonicalProspectivePath(label: string, path: string): string {
  const requested = safeAbsolutePath(label, path);
  let existing = requested;
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) throw new Error(`could not resolve an existing parent for ${label}: ${path}`);
    existing = parent;
  }
  return safeAbsolutePath(label, resolve(realpathSync(existing), relative(existing, requested)));
}

function prepareOwnedDirectory(path: string, uid: number, label: string): string {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const canonical = realpathSync(path);
  const stat = statSync(canonical);
  if (!stat.isDirectory()) throw new Error(`${label} is not a directory: ${canonical}`);
  if (stat.uid !== uid) throw new Error(`${label} must be owned by the current non-root user: ${canonical}`);
  chmodSync(canonical, 0o700);
  try {
    accessSync(canonical, constants.R_OK | constants.W_OK | constants.X_OK);
  } catch {
    throw new Error(`${label} must be readable, writable, and searchable by the current user: ${canonical}`);
  }
  return safeAbsolutePath(label, canonical);
}

function ensureOutsideCheckout(checkout: string, candidate: string, label: string): void {
  if (isWithin(checkout, candidate)) throw new Error(`${label} must be outside the replaceable checkout: ${candidate}`);
}

function ensureSeparateDirectories(dataDir: string, workspace: string): void {
  if (isWithin(dataDir, workspace) || isWithin(workspace, dataDir)) {
    throw new Error('data directory and workspace must be separate, non-overlapping paths');
  }
}

function isWithin(parent: string, candidate: string): boolean {
  const difference = relative(parent, candidate);
  return difference === '' || (!difference.startsWith('..') && !isAbsolute(difference));
}

function safeAbsolutePath(label: string, value: string): string {
  if (!isAbsolute(value)) throw new Error(`${label} must be an absolute path: ${value}`);
  const normalized = resolve(value);
  if (normalized === '/' || !SAFE_PATH.test(normalized) || normalized.includes('%')) {
    throw new Error(`${label} contains unsupported characters (use only letters, numbers, /, ., _, -, +, and @): ${value}`);
  }
  return normalized;
}

function validateUsername(username: string): void {
  if (!SAFE_USER.test(username)) throw new Error(`unsupported service user name: ${username}`);
  if (username === 'root') throw new Error('the systemd service must not run as root');
}

function validatePort(port: number): number {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`port must be an integer from 1 to 65535: ${String(port)}`);
  return port;
}

function requireVersion(label: string, actual: string, minimum: readonly [number, number, number]): void {
  const parsed = /^(?:v|go)?(\d+)\.(\d+)(?:\.(\d+))?/.exec(actual.trim());
  if (parsed === null) throw new Error(`could not parse ${label} version: ${actual}`);
  const version = [Number(parsed[1]), Number(parsed[2]), Number(parsed[3] ?? 0)] as const;
  for (let index = 0; index < minimum.length; index += 1) {
    if (version[index]! > minimum[index]!) return;
    if (version[index]! < minimum[index]!) {
      throw new Error(`${label} ${minimum.join('.')} or newer is required; found ${actual}`);
    }
  }
}

function runChecked(
  runner: CommandRunner,
  command: string,
  args: readonly string[],
  cwd: string,
  inherit = false,
): RunResult {
  const result = runner.run(command, args, { cwd, inherit });
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim();
    throw new Error(
      `required command failed (${command} ${args.join(' ')}); install/fix it and rerun the installer`
      + (detail === '' ? '' : `: ${detail}`),
    );
  }
  return result;
}

async function boundedHealthCheck(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    try {
      const response = await fetch(url, {
        redirect: 'error',
        signal: AbortSignal.timeout(Math.min(2_000, Math.max(1, remaining))),
      });
      if (response.ok) return true;
    } catch {
      // The service may still be starting; retry only until the fixed deadline.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, Math.min(500, Math.max(0, deadline - Date.now()))));
  }
  return false;
}

function usage(): string {
  return `Install a prepared Pop Agent checkout as a production systemd service.\n\n`
    + `Usage:\n  npm run install:server -- --data-dir /absolute/path --workspace /absolute/path [--port 8787]\n\n`
    + `Run as the non-root checkout owner. This command validates the existing host, runs npm ci and the full gate,\n`
    + `then uses sudo only to install and activate ${UNIT_NAME}. It does not install system packages or configure TLS.`;
}

export async function runInstallCli(): Promise<void> {
  try {
    const checkout = realpathSync(resolve(import.meta.dirname, '..'));
    const parsed = parseInstallArguments(process.argv.slice(2), checkout);
    if (parsed === 'help') {
      console.log(usage());
      return;
    }
    await installPreparedCheckout(parsed);
  } catch (error) {
    console.error(`Pop Agent systemd installation failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  await runInstallCli();
}
