import { hostname, arch, platform } from 'node:os';
import WebSocket from 'ws';

/**
 * The terminal's end of the hands channel (docs/cli.md, step 3).
 *
 * Connects, says which machine this is, answers pings, and — from step 3
 * proper — runs what the server asks and posts the result back. The
 * conversation itself keeps flowing over HTTP and SSE; this socket carries
 * only the hands.
 *
 * Answering a ping is the client's whole side of the heartbeat. The server
 * decides when silence has gone on too long; a laptop that closed its lid
 * simply stops replying, which is exactly the signal.
 */

export interface HandsOptions {
  /** Base URL of the server; `http` is swapped for `ws` here. */
  url: string;
  token: string;
  version: string;
  /** Told when the socket opens, closes, or the server answers a claim. */
  onEvent?: (event: HandsEvent) => void;
}

export type HandsEvent =
  | { kind: 'attached' }
  | { kind: 'claimed'; chatId: string; mine: boolean }
  | { kind: 'closed' };

export class Hands {
  private socket: WebSocket | undefined;

  constructor(private readonly options: HandsOptions) {}

  connect(): void {
    const url = `${this.options.url.replace(/^http/, 'ws')}/v1/hands`;
    // A Node client can send headers on the handshake, so the bearer token
    // goes the same way it does everywhere else -- no ticket needed, unlike
    // the SSE stream, which a browser opens and cannot add headers to.
    const socket = new WebSocket(url, {
      headers: { authorization: `Bearer ${this.options.token}` },
    });
    this.socket = socket;

    socket.on('open', () => {
      socket.send(
        JSON.stringify({
          kind: 'attach',
          machine: {
            hostname: hostname(),
            platform: platform(),
            arch: arch(),
            cwd: process.cwd(),
            clientVersion: this.options.version,
          },
        }),
      );
    });

    socket.on('message', (data: Buffer | string) => {
      let frame: { kind?: string; chatId?: string; mine?: boolean };
      try {
        frame = JSON.parse(String(data)) as typeof frame;
      } catch {
        return;
      }
      if (frame.kind === 'ping') {
        socket.send(JSON.stringify({ kind: 'pong' }));
        return;
      }
      if (frame.kind === 'attached') {
        this.options.onEvent?.({ kind: 'attached' });
        return;
      }
      if (frame.kind === 'claimed' && typeof frame.chatId === 'string') {
        this.options.onEvent?.({
          kind: 'claimed',
          chatId: frame.chatId,
          mine: frame.mine === true,
        });
      }
    });

    socket.on('close', () => {
      this.options.onEvent?.({ kind: 'closed' });
    });

    // Swallowed on purpose: a server without the channel, or one that refuses
    // the upgrade, must not take the chat down with it. The screen simply has
    // no local hands.
    socket.on('error', () => undefined);
  }

  /** Asks to be this chat's hands. The server answers with who holds them. */
  claim(chatId: string): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ kind: 'claim', chatId }));
  }

  close(): void {
    this.socket?.close();
    this.socket = undefined;
  }
}
