import { mkdtemp, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { LocalAccess, type LocalAccessEvent } from './local-access.js';

interface Fixture {
  server: Server;
  sockets: WebSocketServer;
  url: string;
}

const fixtures: Fixture[] = [];

async function fixture(): Promise<Fixture> {
  const server = createServer();
  const sockets = new WebSocketServer({ server, path: '/v1/local-tools' });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  const value = { server, sockets, url: `http://127.0.0.1:${String(address.port)}` };
  fixtures.push(value);
  return value;
}

async function eventually(assertion: () => void, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      assertion();
      return;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}

afterEach(async () => {
  for (const value of fixtures.splice(0)) {
    for (const socket of value.sockets.clients) socket.terminate();
    await new Promise<void>((resolve) => value.sockets.close(() => resolve()));
    await new Promise<void>((resolve) => value.server.close(() => resolve()));
  }
});

describe('LocalAccess reconnection', () => {
  it('bounds completed-call replay state for a long-lived tray', () => {
    const localAccess = new LocalAccess({ url: 'https://pop.example', token: 'session', version: '1.0.0' });
    const internal = localAccess as unknown as {
      completedCalls: Map<string, Record<string, unknown>>;
      rememberCompleted(callId: string, event: Record<string, unknown>): void;
    };
    for (let index = 0; index < 1_025; index += 1) {
      internal.rememberCompleted(`call-${String(index)}`, { kind: 'result', ok: true });
    }
    expect(internal.completedCalls.size).toBe(1_024);
    expect(internal.completedCalls.has('call-0')).toBe(false);
    expect(internal.completedCalls.has('call-1024')).toBe(true);
  });

  it('reattaches after the WebSocket drops and exposes the new connection id', async () => {
    const value = await fixture();
    const events: LocalAccessEvent[] = [];
    let connections = 0;

    value.sockets.on('connection', (socket) => {
      connections += 1;
      const number = connections;
      socket.on('message', (raw) => {
        const frame = JSON.parse(String(raw)) as { kind?: string };
        if (frame.kind !== 'attach') return;
        socket.send(JSON.stringify({ kind: 'attached', id: `local-${String(number)}` }));
        if (number === 1) setTimeout(() => socket.close(), 5);
      });
    });

    const localAccess = new LocalAccess({
      url: value.url,
      token: 'session',
      version: '0.2.3',
      reconnectDelayMs: 10,
      onEvent: (event) => events.push(event),
    });
    localAccess.connect();

    await eventually(() => {
      expect(connections).toBe(2);
      expect(localAccess.connectionId).toBe('local-2');
    });
    expect(events.filter((event) => event.kind === 'closed')).toHaveLength(1);
    expect(events.filter((event) => event.kind === 'attached')).toHaveLength(2);
    localAccess.close();
  });

  it('reattaches when an attached WebSocket silently stops receiving server heartbeats', async () => {
    const value = await fixture();
    const events: LocalAccessEvent[] = [];
    let connections = 0;

    value.sockets.on('connection', (socket) => {
      connections += 1;
      const number = connections;
      socket.on('message', (raw) => {
        const frame = JSON.parse(String(raw)) as { kind?: string };
        if (frame.kind !== 'attach') return;
        socket.send(JSON.stringify({ kind: 'attached', id: `local-${String(number)}` }));
      });
    });

    const localAccess = new LocalAccess({
      url: value.url,
      token: 'session',
      version: '0.2.20',
      reconnectDelayMs: 5,
      localLeaseMs: 20,
      onEvent: (event) => events.push(event),
    });
    localAccess.connect();

    await eventually(() => {
      expect(connections).toBeGreaterThanOrEqual(2);
      expect(localAccess.connectionId).toBe('local-2');
    });
    expect(events.some((event) => event.kind === 'closed')).toBe(true);
    localAccess.close();
  });

  it('falls back to authenticated HTTPS after two pre-attach WebSocket failures', async () => {
    const value = await fixture();
    value.sockets.on('connection', (socket) => socket.close());
    const events: LocalAccessEvent[] = [];
    const http: typeof fetch = async (input, init) => {
      const url = String(input);
      expect((init?.headers as Record<string, string>)['authorization']).toBe('Bearer session');
      if (url.endsWith('/v1/session/refresh')) return new Response(null, { status: 204 });
      if (url.endsWith('/v1/local-tools/connections')) {
        return Response.json({ connectionId: 'local-http', frames: [] }, { status: 201 });
      }
      if (url.endsWith('/poll')) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        });
      }
      throw new Error(`unexpected request: ${url}`);
    };
    const localAccess = new LocalAccess({
      url: value.url,
      token: 'session',
      version: '99.0.0',
      reconnectDelayMs: 5,
      fetch: http,
      onEvent: (event) => events.push(event),
    });
    localAccess.connect();
    await eventually(() => expect(localAccess.connectionId).toBe('local-http'));
    expect(events).toContainEqual({
      kind: 'attached',
      connectionId: 'local-http',
      transport: 'https-long-poll',
    });
    localAccess.close();
  });

  it('hides local tools while disabled and sends tray changes over the secure channel', async () => {
    const value = await fixture();
    const received: Record<string, unknown>[] = [];
    value.sockets.on('connection', (socket) => {
      socket.on('message', (raw) => {
        const frame = JSON.parse(String(raw)) as Record<string, unknown>;
        received.push(frame);
        if (frame.kind === 'attach') {
          socket.send(JSON.stringify({ kind: 'attached', id: 'local-disabled', accessEnabled: false }));
          socket.send(JSON.stringify({ kind: 'access_policy', enabled: false }));
        }
      });
    });
    const events: LocalAccessEvent[] = [];
    const localAccess = new LocalAccess({
      url: value.url, token: 'session', version: '0.2.34', onEvent: (event) => events.push(event),
    });
    localAccess.connect();
    await eventually(() => expect(events).toContainEqual({ kind: 'access-policy', enabled: false }));
    expect(localAccess.connectionId).toBeUndefined();

    localAccess.setAccessEnabled(true);
    await eventually(() => expect(received).toContainEqual({ kind: 'set_access', enabled: true }));
    localAccess.close();
  });

  it('does not reconnect after an explicit close', async () => {
    const value = await fixture();
    let connections = 0;
    value.sockets.on('connection', (socket) => {
      connections += 1;
      socket.on('message', (raw) => {
        const frame = JSON.parse(String(raw)) as { kind?: string };
        if (frame.kind === 'attach') {
          socket.send(JSON.stringify({ kind: 'attached', id: 'local-one' }));
        }
      });
    });

    const localAccess = new LocalAccess({
      url: value.url,
      token: 'session',
      version: '0.2.3',
      reconnectDelayMs: 10,
    });
    localAccess.connect();
    await eventually(() => expect(localAccess.connectionId).toBe('local-one'));
    localAccess.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(connections).toBe(1);
  });
});


describe('LocalAccess file operation dispatch', () => {
  it('completes access, read and mkdir prerequisites and returns errors instead of hanging', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pop-local-dispatch-'));
    const localAccess = new LocalAccess({ url: 'https://pop.example', token: 'session', version: '1.0.0' });
    const internal = localAccess as unknown as {
      handleServerFrame(frame: Record<string, unknown>, send: (frame: Record<string, unknown>) => void): Promise<void>;
    };
    const results: Record<string, unknown>[] = [];
    const send = (frame: Record<string, unknown>): void => { results.push(frame); };
    try {
      await internal.handleServerFrame({ kind: 'access_policy', enabled: true }, send);
      const path = join(directory, 'input.txt');
      await writeFile(path, 'local contents');
      const invoke = async (callId: string, tool: string, input: unknown): Promise<Record<string, unknown>> => {
        const before = results.length;
        await internal.handleServerFrame({ kind: 'call', callId, tool, input }, send);
        expect(results).toHaveLength(before + 1);
        expect(results.at(-1)).toMatchObject({ kind: 'result', callId });
        return results.at(-1)!;
      };
      expect(await invoke('access', 'access', { path })).toMatchObject({ ok: true });
      expect(await invoke('read', 'read', { path })).toMatchObject({ ok: true, output: Buffer.from('local contents').toString('base64') });
      const nested = join(directory, 'new', 'nested');
      expect(await invoke('mkdir', 'mkdir', { path: nested })).toMatchObject({ ok: true });
      expect((await stat(nested)).isDirectory()).toBe(true);
      expect(await invoke('missing', 'access', { path: join(directory, 'missing') })).toMatchObject({ ok: false, error: { code: 'not_found', message: expect.any(String) } });
      expect(await invoke('unknown', 'unsupported_operation', {})).toMatchObject({ ok: false, error: { code: 'invalid_input', message: expect.stringContaining('Unknown local tool') } });
      await internal.handleServerFrame({ kind: 'access_policy', enabled: false }, send);
      expect(await invoke('disabled', 'mkdir', { path: join(directory, 'denied') })).toMatchObject({ ok: false, error: expect.stringContaining('disabled') });
    } finally {
      localAccess.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
