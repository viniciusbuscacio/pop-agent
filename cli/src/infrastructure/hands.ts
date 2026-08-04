import { spawn } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
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
  /** Something ran here; the screen says so, because it happened on YOUR machine. */
  | { kind: 'ran'; command: string }
  | { kind: 'closed' };

interface CallFrame {
  callId: string;
  tool: string;
  input: unknown;
}

/** Runs a command, streaming as it goes, and resolves with the exit code. */
function runCommand(
  command: string,
  cwd: string,
  onChunk: (chunk: string) => void,
): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn(command, { cwd, shell: true });
    child.stdout.on('data', (chunk: Buffer) => onChunk(chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => onChunk(chunk.toString('utf8')));
    child.on('error', (error) => {
      onChunk(`${error.message}\n`);
      resolve(null);
    });
    child.on('close', (code) => resolve(code));
  });
}

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
      if (frame.kind === 'call') {
        void this.run(frame as unknown as CallFrame, socket);
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

  /**
   * Does what the server asked, here, and reports back.
   *
   * pi's own local operations are NOT used: the server holds the tool
   * definitions and all their rules -- truncation, size caps, error shapes --
   * and this end only needs to be the disk and the shell. Duplicating pi's
   * operations here would be a second copy of behaviour that has to agree
   * with the first forever.
   */
  private async run(frame: CallFrame, socket: WebSocket): Promise<void> {
    const reply = (result: Record<string, unknown>): void => {
      socket.send(JSON.stringify({ kind: 'result', callId: frame.callId, ...result }));
    };
    const stream = (chunk: string): void => {
      socket.send(JSON.stringify({ kind: 'output', callId: frame.callId, chunk }));
    };

    try {
      const input = frame.input as Record<string, unknown>;
      switch (frame.tool) {
        case 'bash': {
          const command = String(input['command'] ?? '');
          const cwd = String(input['cwd'] ?? process.cwd());
          const exitCode = await runCommand(command, cwd, stream);
          this.options.onEvent?.({ kind: 'ran', command });
          reply({ ok: true, output: '', exitCode });
          return;
        }
        case 'read': {
          const bytes = await readFile(String(input['path']));
          // base64: a file is bytes and this wire is JSON.
          reply({ ok: true, output: bytes.toString('base64') });
          return;
        }
        case 'access': {
          await access(String(input['path']));
          reply({ ok: true, output: '' });
          return;
        }
        case 'write': {
          await writeFile(String(input['path']), String(input['contents'] ?? ''), 'utf8');
          reply({ ok: true, output: '' });
          return;
        }
        case 'mkdir': {
          await mkdir(String(input['path']), { recursive: true });
          reply({ ok: true, output: '' });
          return;
        }
        default:
          reply({ ok: false, output: '', error: `This terminal does not know "${frame.tool}".` });
      }
    } catch (error) {
      reply({
        ok: false,
        output: '',
        error: error instanceof Error ? error.message : 'The terminal could not do that.',
      });
    }
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
