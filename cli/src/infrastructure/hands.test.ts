import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { Hands, type HandsEvent } from './hands.js';

interface Fixture {
  server: Server;
  sockets: WebSocketServer;
  url: string;
}

const fixtures: Fixture[] = [];

async function fixture(): Promise<Fixture> {
  const server = createServer();
  const sockets = new WebSocketServer({ server, path: '/v1/hands' });
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

describe('Hands reconnection', () => {
  it('reattaches after the WebSocket drops and exposes the new connection id', async () => {
    const value = await fixture();
    const events: HandsEvent[] = [];
    let connections = 0;

    value.sockets.on('connection', (socket) => {
      connections += 1;
      const number = connections;
      socket.on('message', (raw) => {
        const frame = JSON.parse(String(raw)) as { kind?: string };
        if (frame.kind !== 'attach') return;
        socket.send(JSON.stringify({ kind: 'attached', id: `hands-${String(number)}` }));
        if (number === 1) setTimeout(() => socket.close(), 5);
      });
    });

    const hands = new Hands({
      url: value.url,
      token: 'session',
      version: '0.2.3',
      reconnectDelayMs: 10,
      onEvent: (event) => events.push(event),
    });
    hands.connect();

    await eventually(() => {
      expect(connections).toBe(2);
      expect(hands.connectionId).toBe('hands-2');
    });
    expect(events.filter((event) => event.kind === 'closed')).toHaveLength(1);
    expect(events.filter((event) => event.kind === 'attached')).toHaveLength(2);
    hands.close();
  });

  it('does not reconnect after an explicit close', async () => {
    const value = await fixture();
    let connections = 0;
    value.sockets.on('connection', (socket) => {
      connections += 1;
      socket.on('message', (raw) => {
        const frame = JSON.parse(String(raw)) as { kind?: string };
        if (frame.kind === 'attach') {
          socket.send(JSON.stringify({ kind: 'attached', id: 'hands-one' }));
        }
      });
    });

    const hands = new Hands({
      url: value.url,
      token: 'session',
      version: '0.2.3',
      reconnectDelayMs: 10,
    });
    hands.connect();
    await eventually(() => expect(hands.connectionId).toBe('hands-one'));
    hands.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(connections).toBe(1);
  });
});
