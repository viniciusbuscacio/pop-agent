import { createInterface } from 'node:readline';
import { LocalAccess, type LocalAccessEvent } from '../infrastructure/local-access.js';
import { VERSION } from '../version.js';
import type { Terminal } from './commands.js';

interface StartConfig {
  kind: 'start';
  protocol: 1;
  url: string;
  token: string;
  role: 'managed-default';
}

export async function managedLocalAccess(terminal: Terminal): Promise<number> {
  const config = await readStartConfig();
  if (config === undefined) {
    terminal.line(JSON.stringify({ kind: 'fatal', code: 'invalid_config' }));
    return 64;
  }

  let fatalCode: number | undefined;
  let finish: () => void = () => undefined;
  const stopped = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const localAccess = new LocalAccess({
    url: config.url,
    token: config.token,
    version: VERSION,
    role: 'managed-default',
    onEvent: (event) => {
      terminal.line(JSON.stringify(toLifecycle(event)));
      if (event.kind === 'outdated') {
        fatalCode = 78;
        finish();
      }
    },
  });

  terminal.line(JSON.stringify({ kind: 'starting', protocol: 1, pid: process.pid, version: VERSION }));
  const stop = (): void => finish();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  localAccess.connect();
  try {
    await stopped;
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    localAccess.close();
  }
  terminal.line(JSON.stringify({ kind: 'stopped', reason: fatalCode === undefined ? 'signal' : 'fatal' }));
  return fatalCode ?? 0;
}

function toLifecycle(event: LocalAccessEvent): Record<string, unknown> {
  switch (event.kind) {
    case 'attached':
      return { kind: 'attached', connectionId: event.connectionId, transport: event.transport };
    case 'closed':
      return { kind: 'reconnecting', reason: 'network' };
    case 'transport':
      return { kind: 'transport', transport: event.transport };
    case 'behind':
      return { kind: 'version_warning', server: event.server, install: event.install };
    case 'outdated':
      return { kind: 'outdated', minimum: event.minimum, server: event.server, install: event.install };
    case 'ran':
      return { kind: 'ran' };
  }
}

function readStartConfig(): Promise<StartConfig | undefined> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
    const timer = setTimeout(() => {
      rl.close();
      resolve(undefined);
    }, 10_000);
    rl.once('line', (line) => {
      clearTimeout(timer);
      rl.close();
      if (Buffer.byteLength(line, 'utf8') > 16 * 1024) {
        resolve(undefined);
        return;
      }
      try {
        const parsed: unknown = JSON.parse(line);
        if (!validConfig(parsed)) {
          resolve(undefined);
          return;
        }
        resolve(parsed);
      } catch {
        resolve(undefined);
      }
    });
    rl.once('close', () => {
      clearTimeout(timer);
    });
  });
}

function validConfig(value: unknown): value is StartConfig {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  if (Object.keys(item).some((key) => !['kind', 'protocol', 'url', 'token', 'role'].includes(key))) return false;
  if (
    item['kind'] !== 'start' ||
    item['protocol'] !== 1 ||
    item['role'] !== 'managed-default' ||
    typeof item['token'] !== 'string' ||
    item['token'].length === 0 ||
    typeof item['url'] !== 'string'
  ) return false;
  try {
    const url = new URL(item['url']);
    return url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname));
  } catch {
    return false;
  }
}
