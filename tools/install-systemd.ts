#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { networkInterfaces, tmpdir, userInfo } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { validateClientPack, verifyClientBootstrap, type ClientPack } from './client-pack.ts';
import { installEvent } from './install-journal.ts';

const MINIMUM_NODE = [22, 19, 0] as const;
const MINIMUM_GO = [1, 23, 0] as const;
const UNIT_NAME = 'pop-agent-service.service';
const UNIT_DESTINATION = `/etc/systemd/system/${UNIT_NAME}`;
const POPMAN_DESTINATION = '/usr/local/bin/popman';
const SAFE_PATH = /^\/[A-Za-z0-9._+@/-]+$/;
const SAFE_USER = /^[a-z_][a-z0-9_-]*\$?$/;

export interface InstallOptions {
  checkout: string;
  dataDir: string;
  workspace: string;
  port: number;
  networkOnboarding?: boolean;
  prebuilt?: boolean;
  bootstrapBind?: string;
  bootstrapPort?: number;
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
  privateIpv4: () => string | undefined;
  bootstrapCheck: (origin: string, pack: ClientPack) => Promise<void>;
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

function defaultDependencies(prebuilt = false): InstallerDependencies {
  return {
    runner: defaultRunner,
    platform: process.platform,
    uid: process.getuid?.() ?? -1,
    username: userInfo().username,
    nodeVersion: process.versions.node,
    nodeExecutable: realpathSync(process.execPath),
    goExecutable: prebuilt ? '' : executableOnPath('go'),
    whisperExecutable: executableOnPath('whisper-cli'),
    systemdRuntimeDir: '/run/systemd/system',
    healthCheck: boundedHealthCheck,
    bootstrapCheck: verifyClientBootstrap,
    privateIpv4: firstPrivateIpv4,
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
  const go = options.prebuilt === true ? '' : safeAbsolutePath('Go executable', goExecutable);
  const whisper = safeAbsolutePath('whisper.cpp executable', whisperExecutable);
  validateUsername(username);
  validatePort(options.port);
  const networkOnboarding = options.networkOnboarding !== false;
  const bootstrapBind = validateBootstrapBind(options.bootstrapBind ?? '127.0.0.1');
  const bootstrapPort = validatePort(options.bootstrapPort ?? 8788);
  if (bootstrapPort === options.port) throw new Error('bootstrap port must differ from the server port');

  const pathDirectories = [
    dirname(node),
    ...(go === '' ? [] : [dirname(go)]),
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
    `After=network-online.target${networkOnboarding ? ' tailscaled.service' : ''}`,
    `Wants=network-online.target${networkOnboarding ? ' tailscaled.service' : ''}`,
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
    ...(options.prebuilt === true ? [`Environment=POP_AGENT_FFMPEG=${checkout}/server/dist/audio/ffmpeg`] : []),
    'Environment=POP_AGENT_BIND=127.0.0.1',
    `Environment=POP_AGENT_PORT=${String(options.port)}`,
    ...(networkOnboarding
      ? [
          `Environment=POP_AGENT_BOOTSTRAP_BIND=${bootstrapBind}`,
          `Environment=POP_AGENT_BOOTSTRAP_PORT=${String(bootstrapPort)}`,
        ]
      : []),
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

export function renderPopmanLauncher(options: InstallOptions, nodeExecutable: string): string {
  const checkout = safeAbsolutePath('checkout', options.checkout);
  const dataDir = safeAbsolutePath('data directory', options.dataDir);
  const workspace = safeAbsolutePath('workspace', options.workspace);
  const node = safeAbsolutePath('Node executable', nodeExecutable);

  return [
    '#!/bin/sh',
    `export POP_AGENT_DATA_DIR=${dataDir}`,
    `export POP_AGENT_WORKSPACE=${workspace}`,
    `exec ${node} ${checkout}/server/dist/manager/main.js "$@"`,
    '',
  ].join('\n');
}

export function parseInstallArguments(args: readonly string[], checkout: string): InstallOptions | 'help' {
  let dataDir: string | undefined;
  let workspace: string | undefined;
  let port = 8787;
  let bootstrapPort = 8788;
  let bootstrapBind: string | undefined;
  let networkOnboarding = true;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') return 'help';
    const value = args[index + 1];
    if (argument === '--skip-network-onboarding') {
      networkOnboarding = false;
      continue;
    }
    if (argument === '--data-dir' || argument === '--workspace' || argument === '--port'
      || argument === '--bootstrap-bind' || argument === '--bootstrap-port') {
      if (value === undefined || value.startsWith('--')) throw new Error(`${argument} requires a value`);
      index += 1;
      if (argument === '--data-dir') dataDir = value;
      if (argument === '--workspace') workspace = value;
      if (argument === '--port') port = Number(value);
      if (argument === '--bootstrap-bind') bootstrapBind = value;
      if (argument === '--bootstrap-port') bootstrapPort = Number(value);
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
    networkOnboarding,
    ...(bootstrapBind === undefined ? {} : { bootstrapBind: validateBootstrapBind(bootstrapBind) }),
    bootstrapPort: validatePort(bootstrapPort),
  };
}

export async function installPreparedCheckout(
  requested: InstallOptions,
  dependencies: InstallerDependencies = defaultDependencies(requested.prebuilt),
  onActivationStart: () => void = () => {},
): Promise<void> {
  installEvent('service-preflight');
  const options = validatePreflight(requested, dependencies);
  const { runner } = dependencies;

  if (options.prebuilt !== true) {
    console.log('Installing locked dependencies as the checkout owner...');
    runChecked(runner, 'npm', ['ci'], options.checkout, true);

    console.log('Running the mandatory repository gate as the checkout owner...');
    runChecked(runner, 'npm', ['run', 'gate'], options.checkout, true);

    console.log('Packing CLI, launcher, local access and managed Node downloads...');
    runChecked(runner, 'npm', ['run', 'pack:cli'], options.checkout, true);

  }

  requireCleanCheckout(runner, options.checkout, 'The gate completed but the checkout is no longer clean. Commit or remove the changes and rerun the installer.');
  const builtServer = join(options.checkout, 'server/dist/main.js');
  if (!existsSync(builtServer) || !statSync(builtServer).isFile()) {
    throw new Error(`the gate did not produce ${builtServer}; inspect the gate output and rerun`);
  }
  const builtManager = join(options.checkout, 'server/dist/manager/main.js');
  if (!existsSync(builtManager) || !statSync(builtManager).isFile()) {
    throw new Error(`the gate did not produce ${builtManager}; inspect the gate output and rerun`);
  }

  const clientPack = validateClientPack(options.checkout, existsSync(join(options.checkout, 'cli/pack/client-downloads.json')) ? 'lazy' : 'complete');

  installEvent('service-directories');
  const dataDir = prepareOwnedDirectory(options.dataDir, dependencies.uid, 'data directory');
  const workspace = prepareOwnedDirectory(options.workspace, dependencies.uid, 'workspace');
  const backupsDir = prepareOwnedDirectory(join(dirname(dataDir), 'pop-backups'), dependencies.uid, 'backup directory');
  ensureOutsideCheckout(options.checkout, dataDir, 'data directory');
  ensureOutsideCheckout(options.checkout, workspace, 'workspace');
  ensureOutsideCheckout(options.checkout, backupsDir, 'backup directory');
  ensureSeparateDirectories(dataDir, workspace);
  ensureSeparateDirectories(backupsDir, workspace);

  const networkOnboarding = options.networkOnboarding !== false;
  const finalOptions = {
    ...options,
    dataDir,
    workspace,
    networkOnboarding,
    ...(networkOnboarding
      ? { bootstrapBind: options.bootstrapBind ?? dependencies.privateIpv4() ?? '127.0.0.1' }
      : {}),
  };
  let setupCode: { code: string; expiresAt: number } | undefined;
  if (networkOnboarding && !existsSync(join(dataDir, 'pop-agent.db'))) {
    setupCode = createServerOnboardingFile(join(dataDir, 'server-onboarding.json'), Date.now());
  }
  const unit = renderSystemdUnit(
    finalOptions,
    dependencies.username,
    dependencies.nodeExecutable,
    dependencies.goExecutable,
    dependencies.whisperExecutable,
  );
  const popmanLauncher = renderPopmanLauncher(finalOptions, dependencies.nodeExecutable);
  const stagingDirectory = mkdtempSync(join(tmpdir(), 'pop-agent-systemd-'));
  const stagedUnit = join(stagingDirectory, UNIT_NAME);
  const stagedPopman = join(stagingDirectory, 'popman');

  try {
    writeFileSync(stagedUnit, unit, { encoding: 'utf8', mode: 0o600 });
    writeFileSync(stagedPopman, popmanLauncher, { encoding: 'utf8', mode: 0o700 });
    if (validateClientPack(options.checkout, existsSync(join(options.checkout, 'cli/pack/client-downloads.json')) ? 'lazy' : 'complete').digest !== clientPack.digest) throw new Error('Client pack changed before activation');
    console.log(`Installing popman and ${UNIT_NAME} through narrowly scoped sudo commands...`);
    if (networkOnboarding) {
      runChecked(runner, 'sudo', ['--', 'tailscale', 'set', `--operator=${dependencies.username}`], options.checkout, true);
    }
    onActivationStart();
    installEvent('service-launcher');
    runChecked(runner, 'sudo', ['--', 'install', '-o', 'root', '-g', 'root', '-m', '0755', stagedPopman, POPMAN_DESTINATION], options.checkout, true);
    installEvent('service-unit');
    runChecked(runner, 'sudo', ['--', 'install', '-o', 'root', '-g', 'root', '-m', '0644', stagedUnit, UNIT_DESTINATION], options.checkout, true);
    installEvent('service-reload');
    runChecked(runner, 'sudo', ['--', 'systemctl', 'daemon-reload'], options.checkout, true);
    installEvent('service-enable');
    runChecked(runner, 'sudo', ['--', 'systemctl', 'enable', UNIT_NAME], options.checkout, true);
    installEvent('service-start');
    runChecked(runner, 'sudo', ['--', 'systemctl', 'restart', UNIT_NAME], options.checkout, true);
  } finally {
    rmSync(stagingDirectory, { recursive: true, force: true });
  }

  installEvent('service-health');
  const healthUrl = `http://127.0.0.1:${String(options.port)}/healthz`;
  console.log(`Waiting up to 30 seconds for ${healthUrl}...`);
  if (!(await dependencies.healthCheck(healthUrl, 30_000))) {
    throw new Error(
      `service installation completed, but ${healthUrl} did not become healthy within 30 seconds; run `
      + `"sudo systemctl status ${UNIT_NAME}" and "sudo journalctl -u ${UNIT_NAME} -n 100 --no-pager"`,
    );
  }
  runChecked(runner, 'systemctl', ['is-active', '--quiet', UNIT_NAME], options.checkout);
  const effectiveCheckout = runChecked(runner, 'systemctl', ['show', UNIT_NAME, '-p', 'WorkingDirectory', '--value'], options.checkout).stdout.trim();
  if (effectiveCheckout !== options.checkout) throw new Error('Active checkout differs from candidate; inspect systemd drop-ins');
  const effectiveCommand = runChecked(runner, 'systemctl', ['show', UNIT_NAME, '-p', 'ExecStart', '--value'], options.checkout).stdout;
  if (systemdCommandIdentity(effectiveCommand) !== `${dependencies.nodeExecutable}\n${dependencies.nodeExecutable} ${options.checkout}/server/dist/main.js`) throw new Error('Active server command differs from candidate; inspect systemd drop-ins');
  await dependencies.bootstrapCheck(`http://127.0.0.1:${String(options.port)}`, clientPack);
  installEvent('service-ready');
  console.log(`Pop Agent is healthy. The service remains loopback-only at http://127.0.0.1:${String(options.port)}.`);
  if (setupCode !== undefined) {
    const setupOrigin = `http://${finalOptions.bootstrapBind}:${String(finalOptions.bootstrapPort ?? 8788)}/setup`;
    console.log('');
    console.log('Continue the private-network setup in a browser:');
    console.log(`  ${setupOrigin}`);
    console.log('');
    installEvent('setup-code-issued');
    console.log(`One-time setup code (valid for 15 minutes): ${setupCode.code}`);
    if (finalOptions.bootstrapBind === '127.0.0.1') {
      console.log('No private LAN address was found. Forward the setup port over SSH before opening the URL.');
      console.log(`  ssh -L ${String(finalOptions.bootstrapPort ?? 8788)}:127.0.0.1:${String(finalOptions.bootstrapPort ?? 8788)} <server>`);
    }
  }
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
  if (requested.prebuilt !== true) safeAbsolutePath('Go executable', dependencies.goExecutable);
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
  const networkOnboarding = requested.networkOnboarding !== false && (
    !existsSync(join(dataDir, 'pop-agent.db'))
    || existsSync(join(dataDir, 'server-onboarding.json'))
  );
  validatePort(requested.port);
  ensureOutsideCheckout(checkout, dataDir, 'data directory');
  ensureOutsideCheckout(checkout, workspace, 'workspace');
  ensureSeparateDirectories(dataDir, workspace);

  const { runner } = dependencies;
  const gitVersion = runChecked(runner, 'git', ['--version'], checkout).stdout.trim();
  if (!/^git version \d+\./.test(gitVersion)) throw new Error(`could not validate Git: ${gitVersion || 'no version output'}`);
  if (requested.prebuilt !== true) {
    const npmVersion = runChecked(runner, 'npm', ['--version'], checkout).stdout.trim();
    if (!/^\d+\.\d+\.\d+/.test(npmVersion)) throw new Error(`could not validate npm: ${npmVersion || 'no version output'}`);
    const goVersion = runChecked(runner, 'go', ['version'], checkout).stdout;
    const goMatch = /\bgo(\d+\.\d+(?:\.\d+)?)/.exec(goVersion);
    if (goMatch?.[1] === undefined) throw new Error(`could not parse Go version from: ${goVersion.trim() || 'no version output'}`);
    requireVersion('Go', goMatch[1], MINIMUM_GO);
  }
  runChecked(runner, 'systemctl', ['--version'], checkout);
  runChecked(runner, 'sudo', ['--version'], checkout);
  runChecked(runner, 'install', ['--version'], checkout);
  if (networkOnboarding) {
    const tailscaleVersion = runChecked(runner, 'tailscale', ['version'], checkout).stdout.trim();
    const version = /^\d+\.\d+\.\d+/.exec(tailscaleVersion)?.[0];
    if (version !== undefined) installEvent('tailscale-version', { version });
    if (!/^\d+\.\d+/.test(tailscaleVersion)) {
      throw new Error(`could not validate Tailscale: ${tailscaleVersion || 'no version output'}`);
    }
  }

  const repositoryRoot = realpathSync(runChecked(runner, 'git', ['rev-parse', '--show-toplevel'], checkout).stdout.trim());
  if (repositoryRoot !== checkout) throw new Error(`installer must run from the repository root; Git reports ${repositoryRoot}`);
  requireCleanCheckout(runner, checkout, 'checkout is not clean; commit or remove staged, unstaged, and untracked files before installation');

  return { ...requested, checkout, dataDir, workspace, networkOnboarding };
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

function validateBootstrapBind(value: string): string {
  if (value === '127.0.0.1') return value;
  const octets = value.split('.').map(Number);
  const valid = octets.length === 4 && octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255);
  const privateAddress = valid && (
    octets[0] === 10
    || (octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31)
    || (octets[0] === 192 && octets[1] === 168)
  );
  if (!privateAddress) throw new Error(`bootstrap bind must be loopback or an RFC1918 private IPv4 address: ${value}`);
  return value;
}

function firstPrivateIpv4(): string | undefined {
  const candidates: string[] = [];
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family !== 'IPv4' || address.internal) continue;
      try {
        candidates.push(validateBootstrapBind(address.address));
      } catch {
        // Public and link-local addresses must never host the plaintext setup surface.
      }
    }
  }
  return candidates.sort((left, right) => privateAddressRank(left) - privateAddressRank(right)
    || left.localeCompare(right))[0];
}

function privateAddressRank(address: string): number {
  if (address.startsWith('192.168.')) return 0;
  if (address.startsWith('10.')) return 1;
  return 2;
}

function createServerOnboardingFile(path: string, now: number): { code: string; expiresAt: number } {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const code = Array.from(randomBytes(12), (byte) => alphabet[byte % alphabet.length]!)
    .join('')
    .replace(/(.{4})(?=.)/g, '$1-');
  const normalized = code.replaceAll('-', '');
  const salt = randomBytes(16).toString('hex');
  const expiresAt = now + 15 * 60_000;
  const record = {
    version: 1,
    phase: 'pairing',
    codeSalt: salt,
    codeDigest: createHash('sha256').update(salt).update('\0').update(normalized).digest('hex'),
    codeExpiresAt: expiresAt,
    failedAttempts: 0,
  };
  const temporary = `${path}.${String(process.pid)}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
  return { code, expiresAt };
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
  const started = Date.now();
  installEvent('command-start', { command });
  const result = runner.run(command, args, { cwd, inherit });
  installEvent('command-finish', { command, exit_code: result.status, duration_ms: Date.now() - started });
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
    + `Network options:\n  --bootstrap-bind PRIVATE_IP  --bootstrap-port 8788  --skip-network-onboarding\n\n`
    + `Run as the non-root checkout owner. This command validates the existing host, runs npm ci and the full gate,\n`
    + `then uses sudo only to delegate Tailscale to the service user, install popman, and activate ${UNIT_NAME}. `
    + `It does not install system packages.`;
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

/** Ignore volatile process status fields when comparing the effective unit command. */
export function systemdCommandIdentity(value: string): string {
  const match = /path=([^;]+?) ; argv\[\]=([^;]+?) ;/.exec(value);
  if (!match) throw new Error('Cannot identify effective systemd command');
  return `${match[1]!.trim()}\n${match[2]!.trim()}`;
}
