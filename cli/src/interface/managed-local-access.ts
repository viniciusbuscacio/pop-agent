import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
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

interface SessionUpdate {
  kind: 'session';
  token: string;
}

export async function managedLocalAccess(terminal: Terminal): Promise<number> {
  const input = createManagedInput(process.stdin);
  const config = await input.initial;
  if (config === undefined) {
    input.close();
    terminal.line(JSON.stringify({ kind: 'fatal', code: 'invalid_config' }));
    return 64;
  }

  let fatalCode: number | undefined;
  let stopReason: 'signal' | 'input_closed' | 'fatal' = 'signal';
  let finish: () => void = () => undefined;
  const stopped = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const localAccess = new LocalAccess({
    url: config.url,
    // The Desktop keeps stdin open and can replace a renewed web session
    // without tearing down an in-flight local call. The new token is used on
    // the next HTTP request or reconnect.
    token: () => input.token(),
    version: VERSION,
    role: 'managed-default',
    onEvent: (event) => {
      terminal.line(JSON.stringify(toLifecycle(event)));
      if (event.kind === 'outdated') {
        fatalCode = 78;
        stopReason = 'fatal';
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
    await Promise.race([
      stopped,
      input.closed.then(() => {
        stopReason = 'input_closed';
      }),
    ]);
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    localAccess.close();
    input.close();
  }
  terminal.line(JSON.stringify({ kind: 'stopped', reason: stopReason }));
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

export interface ManagedInput {
  initial: Promise<StartConfig | undefined>;
  closed: Promise<void>;
  token(): string;
  close(): void;
}

export function createManagedInput(source: Readable): ManagedInput {
  const rl = createInterface({ input: source, crlfDelay: Infinity });
  let token = '';
  let receivedInitial = false;
  let resolveInitial: (value: StartConfig | undefined) => void = () => undefined;
  let resolveClosed: () => void = () => undefined;
  const initial = new Promise<StartConfig | undefined>((resolve) => {
    resolveInitial = resolve;
  });
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
  const timer = setTimeout(() => {
    if (!receivedInitial) resolveInitial(undefined);
    rl.close();
  }, 10_000);

  rl.on('line', (line) => {
    if (Buffer.byteLength(line, 'utf8') > 16 * 1024) {
      if (!receivedInitial) {
        receivedInitial = true;
        clearTimeout(timer);
        resolveInitial(undefined);
        rl.close();
      }
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      parsed = undefined;
    }
    if (!receivedInitial) {
      receivedInitial = true;
      clearTimeout(timer);
      if (!validConfig(parsed)) {
        resolveInitial(undefined);
        rl.close();
        return;
      }
      token = parsed.token;
      resolveInitial(parsed);
      return;
    }
    if (validSessionUpdate(parsed)) token = parsed.token;
  });
  rl.once('close', () => {
    clearTimeout(timer);
    if (!receivedInitial) {
      receivedInitial = true;
      resolveInitial(undefined);
    }
    resolveClosed();
  });

  return { initial, closed, token: () => token, close: () => rl.close() };
}

function validConfig(value: unknown): value is StartConfig {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  if (Object.keys(item).some((key) => !['kind', 'protocol', 'url', 'token', 'role'].includes(key))) return false;
  if (
    item['kind'] !== 'start' ||
    item['protocol'] !== 1 ||
    item['role'] !== 'managed-default' ||
    !validToken(item['token']) ||
    typeof item['url'] !== 'string'
  ) return false;
  try {
    const url = new URL(item['url']);
    return url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname));
  } catch {
    return false;
  }
}

function validSessionUpdate(value: unknown): value is SessionUpdate {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return Object.keys(item).every((key) => ['kind', 'token'].includes(key)) &&
    item['kind'] === 'session' && validToken(item['token']);
}

function validToken(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 12 * 1024;
}
