import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { userInfo } from 'node:os';
import type {
  TailnetStatus,
  TailscaleGateway,
} from '../../application/ports/server-onboarding.js';

const MAX_OUTPUT = 64 * 1024;
const COMMAND_TIMEOUT_MS = 15_000;
const LOGIN_URL = /https:\/\/login\.tailscale\.com\/a\/[A-Za-z0-9]+/;
const CONSENT_URL = /https:\/\/login\.tailscale\.com\/[^\s]+/g;
const DNS_NAME = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.ts\.net\.$/;

export class TailscaleCliGateway implements TailscaleGateway {
  private loginProcess: ChildProcess | undefined;
  private loginUrl: string | undefined;

  constructor(private readonly originPort: number) {}

  status(): TailnetStatus {
    const status = runTailscale(['status', '--json']);
    if (status === undefined) {
      return { installed: commandExists(), connected: false, serve: 'none' };
    }
    const parsed = parseStatus(status);
    if (parsed === undefined || parsed.backendState !== 'Running') {
      return { installed: true, connected: false, serve: 'none' };
    }
    const serve = runTailscale(['serve', 'status', '--json']);
    return {
      installed: true,
      connected: true,
      ...(parsed.dnsName === undefined ? {} : { dnsName: parsed.dnsName }),
      serve: serve === undefined ? 'none' : classifyServe(serve, this.originPort),
    };
  }

  beginLogin(): Promise<string | undefined> {
    if (this.status().connected) return Promise.resolve(undefined);
    if (!commandExists()) return Promise.resolve(undefined);
    if (this.loginUrl !== undefined) return Promise.resolve(this.loginUrl);

    return new Promise((resolve, reject) => {
      if (this.loginProcess !== undefined) {
        const deadline = Date.now() + COMMAND_TIMEOUT_MS;
        const poll = setInterval(() => {
          if (this.loginUrl !== undefined) {
            clearInterval(poll);
            resolve(this.loginUrl);
          } else if (Date.now() >= deadline || this.loginProcess === undefined) {
            clearInterval(poll);
            reject(new Error('Tailscale did not provide a login URL.'));
          }
        }, 100);
        return;
      }

      const child = spawn('tailscale', ['up', '--timeout=10m', `--operator=${userInfo().username}`], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: commandEnvironment(),
      });
      this.loginProcess = child;
      let output = '';
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error('Tailscale did not provide a login URL.'));
        }
      }, COMMAND_TIMEOUT_MS);

      const inspect = (chunk: Buffer): void => {
        if (output.length < MAX_OUTPUT) output += chunk.toString('utf8').slice(0, MAX_OUTPUT - output.length);
        const found = output.match(LOGIN_URL)?.[0];
        if (found !== undefined && !settled) {
          settled = true;
          clearTimeout(timer);
          this.loginUrl = found;
          resolve(found);
        }
      };
      child.stdout?.on('data', inspect);
      child.stderr?.on('data', inspect);
      child.once('error', () => {
        this.loginProcess = undefined;
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error('Tailscale could not be started.'));
        }
      });
      child.once('close', () => {
        this.loginProcess = undefined;
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error('Tailscale stopped before providing a login URL.'));
        }
      });
    });
  }

  enableHttps(hostname?: string):
    | { ok: true; secureUrl: string }
    | { ok: false; reason: 'not_installed' | 'not_connected' | 'conflict' | 'failed' }
    | { ok: false; reason: 'approval_required'; approvalUrl: string } {
    const before = this.status();
    if (!before.installed) return { ok: false, reason: 'not_installed' };
    if (!before.connected) return { ok: false, reason: 'not_connected' };
    if (before.serve === 'conflict') return { ok: false, reason: 'conflict' };

    if (hostname !== undefined) {
      if (runTailscale(['set', `--hostname=${hostname}`]) === undefined) {
        return { ok: false, reason: 'failed' };
      }
    }

    if (before.serve === 'none') {
      const target = `http://127.0.0.1:${String(this.originPort)}`;
      const served = runTailscaleResult(['serve', '--bg', '--yes', target]);
      if (!served.ok) {
        const approvalUrl = consentUrlFrom(served.output);
        if (approvalUrl !== undefined) {
          return { ok: false, reason: 'approval_required', approvalUrl };
        }
        return { ok: false, reason: 'failed' };
      }
    }

    const after = this.status();
    const dnsName = after.dnsName?.replace(/\.$/, '');
    if (after.serve !== 'ours' || dnsName === undefined) return { ok: false, reason: 'failed' };
    return { ok: true, secureUrl: `https://${dnsName}` };
  }
}

function commandExists(): boolean {
  const result = spawnSync('tailscale', ['version'], {
    encoding: 'utf8',
    timeout: COMMAND_TIMEOUT_MS,
    maxBuffer: MAX_OUTPUT,
    env: commandEnvironment(),
  });
  return result.status === 0;
}

function runTailscale(args: readonly string[]): string | undefined {
  const result = runTailscaleResult(args);
  return result.ok ? result.output : undefined;
}

function runTailscaleResult(args: readonly string[]): { ok: boolean; output: string } {
  const result = spawnSync('tailscale', args, {
    encoding: 'utf8',
    timeout: COMMAND_TIMEOUT_MS,
    maxBuffer: MAX_OUTPUT,
    env: commandEnvironment(),
  });
  return {
    ok: result.status === 0,
    output: `${result.stdout ?? ''}\n${result.stderr ?? ''}`.slice(0, MAX_OUTPUT),
  };
}

function commandEnvironment(): NodeJS.ProcessEnv {
  return {
    PATH: process.env['PATH'] ?? '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    LANG: process.env['LANG'] ?? 'C.UTF-8',
  };
}

function parseStatus(value: string): { backendState: string; dnsName?: string } | undefined {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const backendState = parsed['BackendState'];
    const self = parsed['Self'];
    if (typeof backendState !== 'string' || typeof self !== 'object' || self === null) return undefined;
    const dnsName = (self as Record<string, unknown>)['DNSName'];
    return {
      backendState,
      ...(typeof dnsName === 'string' && DNS_NAME.test(dnsName) ? { dnsName } : {}),
    };
  } catch {
    return undefined;
  }
}

export function classifyServe(value: string, originPort: number): 'none' | 'ours' | 'conflict' {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (Object.keys(parsed).length === 0) return 'none';
    const tcp = parsed['TCP'];
    const web = parsed['Web'];
    if (typeof tcp !== 'object' || tcp === null || typeof web !== 'object' || web === null) {
      return 'conflict';
    }
    const https = (tcp as Record<string, unknown>)['443'];
    if (typeof https !== 'object' || https === null || (https as Record<string, unknown>)['HTTPS'] !== true) {
      return 'conflict';
    }
    const sites = Object.values(web as Record<string, unknown>);
    if (sites.length !== 1 || typeof sites[0] !== 'object' || sites[0] === null) return 'conflict';
    const handlers = (sites[0] as Record<string, unknown>)['Handlers'];
    if (typeof handlers !== 'object' || handlers === null) return 'conflict';
    const root = (handlers as Record<string, unknown>)['/'];
    if (typeof root !== 'object' || root === null) return 'conflict';
    return (root as Record<string, unknown>)['Proxy'] === `http://127.0.0.1:${String(originPort)}`
      ? 'ours'
      : 'conflict';
  } catch {
    return 'conflict';
  }
}

export function consentUrlFrom(output: string): string | undefined {
  for (const candidate of output.match(CONSENT_URL) ?? []) {
    try {
      const parsed = new URL(candidate.replace(/[),.;]+$/, ''));
      if (
        parsed.protocol === 'https:'
        && parsed.hostname === 'login.tailscale.com'
        && (parsed.pathname.startsWith('/admin/') || parsed.pathname.startsWith('/a/'))
        && parsed.username === ''
        && parsed.password === ''
      ) {
        parsed.hash = '';
        return parsed.toString();
      }
    } catch {
      // Ignore malformed command output; no unvalidated link reaches the browser.
    }
  }
  return undefined;
}
