import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  installPreparedCheckout,
  parseInstallArguments,
  renderPopmanLauncher,
  renderSystemdUnit,
  type CommandRunner,
  type InstallOptions,
  type InstallerDependencies,
} from './install-systemd.js';

interface Call {
  command: string;
  args: readonly string[];
  cwd: string;
  inherit: boolean;
}

class FakeRunner implements CommandRunner {
  readonly calls: Call[] = [];
  installedUnit = '';
  installedPopman = '';
  dirty = false;
  goVersion = 'go version go1.23.6 linux/amd64\n';
  checkout = '';

  run(command: string, args: readonly string[], options: { cwd: string; inherit?: boolean }) {
    this.calls.push({ command, args: [...args], cwd: options.cwd, inherit: options.inherit ?? false });
    const key = `${command} ${args.join(' ')}`;
    if (key === 'git --version') return result('git version 2.43.0\n');
    if (key === 'npm --version') return result('10.8.2\n');
    if (key === 'go version') return result(this.goVersion);
    if (key === 'systemctl --version') return result('systemd 255\n');
    if (key === 'sudo --version') return result('Sudo version 1.9.15\n');
    if (key === 'install --version') return result('install (GNU coreutils) 9.4\n');
    if (key === 'git rev-parse --show-toplevel') return result(`${this.checkout}\n`);
    if (key === 'git status --porcelain=v1 --untracked-files=normal') return result(this.dirty ? '?? unexpected\n' : '');
    if (command === 'sudo' && args[1] === 'install') {
      const source = args[args.length - 2]!;
      const destination = args[args.length - 1];
      if (destination === '/etc/systemd/system/pop-agent-service.service') {
        this.installedUnit = readFileSync(source, 'utf8');
      }
      if (destination === '/usr/local/bin/popman') {
        this.installedPopman = readFileSync(source, 'utf8');
      }
    }
    return result('');
  }
}

let root = '';

afterEach(() => {
  if (root !== '') rmSync(root, { recursive: true, force: true });
  root = '';
});

function result(stdout: string, status = 0): { status: number; stdout: string; stderr: string } {
  return { status, stdout, stderr: '' };
}

function fixture(): { options: InstallOptions; dependencies: InstallerDependencies; runner: FakeRunner } {
  root = mkdtempSync(join(tmpdir(), 'pop-systemd-test-'));
  const checkout = join(root, 'checkout');
  const systemdRuntime = join(root, 'run/systemd/system');
  mkdirSync(join(checkout, 'server/dist/manager'), { recursive: true });
  mkdirSync(systemdRuntime, { recursive: true });
  writeFileSync(join(checkout, 'package.json'), '{}\n');
  writeFileSync(join(checkout, 'package-lock.json'), '{}\n');
  writeFileSync(join(checkout, 'server/dist/main.js'), 'export {};\n');
  writeFileSync(join(checkout, 'server/dist/manager/main.js'), 'export {};\n');

  const runner = new FakeRunner();
  runner.checkout = checkout;
  const uid = process.getuid?.() ?? 1000;
  return {
    options: {
      checkout,
      dataDir: join(root, 'data'),
      workspace: join(root, 'workspace'),
      port: 8787,
    },
    dependencies: {
      runner,
      platform: 'linux',
      uid,
      username: 'popowner',
      nodeVersion: '22.19.0',
      nodeExecutable: '/usr/bin/node',
      goExecutable: '/usr/local/go/bin/go',
      whisperExecutable: '/opt/pop-whisper/whisper-cli',
      systemdRuntimeDir: systemdRuntime,
      healthCheck: async () => true,
    },
    runner,
  };
}

describe('systemd server installer', () => {
  it('starts through the dependency-free bootstrap without touching systemd for help', () => {
    const invocation = spawnSync(process.execPath, [join(import.meta.dirname, 'install-systemd.mjs'), '--help'], {
      encoding: 'utf8',
    });
    expect(invocation.status).toBe(0);
    expect(invocation.stdout).toContain('Install a prepared Pop Agent checkout');
    expect(invocation.stdout).toContain('does not install system packages');
  });

  it('renders a production, loopback-only, non-root unit with bounded restart', () => {
    const unit = renderSystemdUnit({
      checkout: '/srv/pop-agent/source',
      dataDir: '/srv/pop-agent/data',
      workspace: '/srv/pop-agent/workspace',
      port: 9123,
    }, 'popowner', '/opt/pop-node/bin/node', '/opt/pop-go/bin/go', '/opt/pop-whisper/whisper-cli');

    expect(unit).toContain('User=popowner\n');
    expect(unit).toContain('WorkingDirectory=/srv/pop-agent/source\n');
    expect(unit).toContain('Environment=PATH=/opt/pop-node/bin:/opt/pop-go/bin:/opt/pop-whisper:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\n');
    expect(unit).toContain('Environment=PI_OFFLINE=1\n');
    expect(unit).toContain('Environment=POP_AGENT_BIND=127.0.0.1\n');
    expect(unit).toContain('Environment=POP_AGENT_DATA_DIR=/srv/pop-agent/data\n');
    expect(unit).toContain('Environment=POP_AGENT_WORKSPACE=/srv/pop-agent/workspace\n');
    expect(unit).toContain('ExecStart=/opt/pop-node/bin/node /srv/pop-agent/source/server/dist/main.js\n');
    expect(unit).toContain('Restart=on-failure\nRestartSec=5s\n');
    expect(unit).toContain('StartLimitIntervalSec=60\nStartLimitBurst=5\n');
    expect(unit).not.toContain('tsx');
    expect(unit).not.toContain('EnvironmentFile');
    expect(unit).not.toContain('vinicius');
  });

  it('renders popman with the managed Node and the installed data paths', () => {
    const launcher = renderPopmanLauncher({
      checkout: '/srv/pop-agent/source',
      dataDir: '/srv/pop-agent/data',
      workspace: '/srv/pop-agent/workspace',
      port: 8787,
    }, '/opt/pop-node/bin/node');

    expect(launcher).toBe([
      '#!/bin/sh',
      'export POP_AGENT_DATA_DIR=/srv/pop-agent/data',
      'export POP_AGENT_WORKSPACE=/srv/pop-agent/workspace',
      'exec /opt/pop-node/bin/node /srv/pop-agent/source/server/dist/manager/main.js "$@"',
      '',
    ].join('\n'));
  });

  it('rejects relative or unit-injection-like paths and invalid ports', () => {
    expect(() => parseInstallArguments(['--data-dir', 'relative', '--workspace', '/srv/work'], '/srv/source'))
      .toThrow('absolute path');
    expect(() => parseInstallArguments(['--data-dir', '/srv/data\nUser=root', '--workspace', '/srv/work'], '/srv/source'))
      .toThrow('unsupported characters');
    expect(() => parseInstallArguments(['--data-dir', '/srv/data', '--workspace', '/srv/work', '--port', '0'], '/srv/source'))
      .toThrow('port must be');
  });

  it('runs owner-only build work, installs through explicit sudo calls, and verifies health', async () => {
    const { options, dependencies, runner } = fixture();
    const healthCalls: Array<{ url: string; timeout: number }> = [];
    dependencies.healthCheck = async (url, timeout) => {
      healthCalls.push({ url, timeout });
      return true;
    };

    await installPreparedCheckout(options, dependencies);

    const commandLines = runner.calls.map((call) => `${call.command} ${call.args.join(' ')}`);
    expect(commandLines).toContain('npm ci');
    expect(commandLines).toContain('npm run gate');
    expect(commandLines).toContain('sudo -- systemctl daemon-reload');
    expect(commandLines).toContain('sudo -- systemctl enable pop-agent-service.service');
    expect(commandLines).toContain('sudo -- systemctl restart pop-agent-service.service');
    expect(commandLines.indexOf('npm ci')).toBeLessThan(commandLines.indexOf('npm run gate'));
    expect(commandLines.indexOf('npm run gate')).toBeLessThan(commandLines.indexOf('sudo -- systemctl daemon-reload'));
    expect(runner.calls.find((call) => call.command === 'npm' && call.args[0] === 'ci')?.inherit).toBe(true);
    expect(runner.installedUnit).toContain(`WorkingDirectory=${realpathSync(options.checkout)}\n`);
    expect(runner.installedPopman).toContain(`export POP_AGENT_DATA_DIR=${realpathSync(options.dataDir)}\n`);
    expect(runner.installedPopman).toContain(`export POP_AGENT_WORKSPACE=${realpathSync(options.workspace)}\n`);
    expect(runner.installedPopman).toContain(`exec /usr/bin/node ${realpathSync(options.checkout)}/server/dist/manager/main.js "$@"\n`);
    const popmanInstall = runner.calls.find((call) => call.command === 'sudo' && call.args.at(-1) === '/usr/local/bin/popman');
    expect(popmanInstall?.args).toContain('0755');
    expect(healthCalls).toEqual([{ url: 'http://127.0.0.1:8787/healthz', timeout: 30_000 }]);
    expect(commandLines).toContain('systemctl is-active --quiet pop-agent-service.service');
    expect(statSync(options.dataDir).mode & 0o777).toBe(0o700);
    expect(statSync(options.workspace).mode & 0o777).toBe(0o700);
    expect(statSync(join(dirname(options.dataDir), 'pop-backups')).mode & 0o777).toBe(0o700);
  });

  it('resolves symlinked parents before refusing data paths inside the checkout', async () => {
    const linked = fixture();
    const link = join(root, 'checkout-link');
    symlinkSync(linked.options.checkout, link, 'dir');
    linked.options.dataDir = join(link, 'data');

    await expect(installPreparedCheckout(linked.options, linked.dependencies)).rejects.toThrow('must be outside the replaceable checkout');
    expect(existsSync(join(linked.options.checkout, 'data'))).toBe(false);
    expect(linked.runner.calls.some((call) => call.command === 'npm' && call.args[0] === 'ci')).toBe(false);
  });

  it('fails before npm or sudo for a dirty checkout or an old mandatory Go toolchain', async () => {
    const dirty = fixture();
    dirty.runner.dirty = true;
    await expect(installPreparedCheckout(dirty.options, dirty.dependencies)).rejects.toThrow('checkout is not clean');
    expect(dirty.runner.calls.some((call) => call.command === 'npm' && call.args[0] === 'ci')).toBe(false);
    expect(dirty.runner.calls.some((call) => call.command === 'sudo' && call.args[0] === '--')).toBe(false);

    rmSync(root, { recursive: true, force: true });
    root = '';
    const oldGo = fixture();
    oldGo.runner.goVersion = 'go version go1.22.9 linux/amd64\n';
    await expect(installPreparedCheckout(oldGo.options, oldGo.dependencies)).rejects.toThrow('Go 1.23.0 or newer is required');
    expect(oldGo.runner.calls.some((call) => call.command === 'npm' && call.args[0] === 'ci')).toBe(false);
  });

  it('refuses root execution and reports bounded health failure without hiding activation', async () => {
    const rootRun = fixture();
    rootRun.dependencies.uid = 0;
    await expect(installPreparedCheckout(rootRun.options, rootRun.dependencies)).rejects.toThrow('do not run this installer as root');
    expect(rootRun.runner.calls).toEqual([]);

    rmSync(root, { recursive: true, force: true });
    root = '';
    const unhealthy = fixture();
    unhealthy.dependencies.healthCheck = async () => false;
    await expect(installPreparedCheckout(unhealthy.options, unhealthy.dependencies)).rejects.toThrow('did not become healthy within 30 seconds');
  });
});
