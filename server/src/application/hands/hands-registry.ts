/**
 * Which terminals are attached, and whose hands they are (docs/cli.md,
 * step 3).
 *
 * All the bookkeeping, none of the sockets: connections arrive as an id and a
 * way to send, so the rules below can be tested without a network. The
 * transport lives in `interface/http/hands-routes`.
 *
 * Three rules, each answering a way this goes wrong:
 *
 * 1. **A chat has at most one pair of hands.** The event stream deliberately
 *    sends everything to everyone -- right for "here is a word of the answer",
 *    wrong for "run this on your machine", which has exactly one addressee.
 * 2. **Ownership never changes mid-run.** Opening a chat that is already
 *    answering makes you a spectator until it ends; the hands are yours from
 *    the next message. Otherwise a tool call parked on one connection would
 *    have to be answered by another (Vinicius, 04/08).
 * 3. **A silent connection is a gone connection.** A closed laptop lid does
 *    not close a TCP socket, and a run parked on a sleeping machine holds the
 *    queue for every other client. The heartbeat measures the MACHINE, never
 *    the command: a twenty-minute install is ordinary and answers pings all
 *    the way through.
 */

import { entityId } from '../../domain/ids.js';

/** How often the server pings, and how many silences it forgives. */
export const PING_EVERY_MS = 15_000;
export const MISSED_PINGS_BEFORE_GONE = 3;

/** What a terminal says about itself when it attaches. */
export interface HandsMachine {
  hostname: string;
  platform: string;
  arch: string;
  /** Where `popy` was launched; the directory `bash` starts in. */
  cwd: string;
  clientVersion: string;
}

export interface HandsConnection {
  id: string;
  machine: HandsMachine;
  /** Delivers a frame to that terminal. */
  send(frame: unknown): void;
  /** Ends the connection; the registry calls it when the machine goes quiet. */
  close(): void;
}

interface Entry {
  connection: HandsConnection;
  /** Pings sent since the last thing heard back. */
  unanswered: number;
}

/** One tool call in flight on a terminal. */
interface Pending {
  connectionId: string;
  settle: (result: HandsResult) => void;
  onOutput: (chunk: string) => void;
}

/** What a terminal reports back when a call finishes. */
export interface HandsResult {
  ok: boolean;
  /** Everything the command wrote, already streamed through `onOutput` too. */
  output: string;
  /** Process exit code, when the call was a command. */
  exitCode?: number | null;
  /** Why it could not run at all -- not the command's own failure. */
  error?: string;
}

export interface HandsCall {
  tool: string;
  input: unknown;
}

export class HandsRegistry {
  private readonly entries = new Map<string, Entry>();
  /** chatId -> connection id. */
  private readonly owners = new Map<string, string>();
  /** callId -> what is waiting for it. */
  private readonly pending = new Map<string, Pending>();

  constructor(private readonly onJournal?: (line: string) => void) {}

  attach(connection: HandsConnection): void {
    this.entries.set(connection.id, { connection, unanswered: 0 });
    this.onJournal?.(
      `popy hands: attached ${connection.machine.hostname} (${connection.machine.platform}/${connection.machine.arch})`,
    );
  }

  detach(connectionId: string): void {
    const entry = this.entries.get(connectionId);
    if (entry === undefined) return;
    this.entries.delete(connectionId);
    this.releaseCalls(connectionId);
    for (const [chatId, owner] of [...this.owners]) {
      if (owner === connectionId) this.owners.delete(chatId);
    }
    this.onJournal?.(`popy hands: detached ${entry.connection.machine.hostname}`);
  }

  /** Anything heard from a terminal proves it is alive, not just a pong. */
  heard(connectionId: string): void {
    const entry = this.entries.get(connectionId);
    if (entry !== undefined) entry.unanswered = 0;
  }

  /**
   * Claims the hands for a chat, unless someone else already holds them.
   * Returns who holds them afterwards, which may be the other connection.
   */
  claim(chatId: string, connectionId: string): string | undefined {
    if (!this.entries.has(connectionId)) return this.owners.get(chatId);
    const current = this.owners.get(chatId);
    if (current !== undefined && current !== connectionId && this.entries.has(current)) {
      return current;
    }
    this.owners.set(chatId, connectionId);
    return connectionId;
  }

  /** The connection that runs this chat's local tools, if any is attached. */
  handsFor(chatId: string): HandsConnection | undefined {
    const owner = this.owners.get(chatId);
    if (owner === undefined) return undefined;
    return this.entries.get(owner)?.connection;
  }

  /**
   * Runs something on the chat's terminal and waits for the answer.
   *
   * Rejects when no terminal holds the hands, rather than falling back to the
   * server: "run this on my machine" answered by the wrong machine is worse
   * than an error, and the model can be told plainly that the terminal left.
   *
   * There is no timeout here on purpose. The heartbeat is what decides a
   * machine is gone; a command may legitimately take twenty minutes, and a
   * clock on the call would cut exactly the long build the terminal exists
   * for. When the machine does go, `releaseCalls` fails everything pending.
   */
  call(chatId: string, request: HandsCall, onOutput: (chunk: string) => void): Promise<HandsResult> {
    const connection = this.handsFor(chatId);
    if (connection === undefined) {
      return Promise.reject(new Error('No terminal is attached to this conversation.'));
    }
    const callId = entityId('call');
    return new Promise<HandsResult>((resolve) => {
      this.pending.set(callId, { connectionId: connection.id, settle: resolve, onOutput });
      connection.send({ kind: 'call', callId, tool: request.tool, input: request.input });
    });
  }

  /** A chunk of output arrived for a call still running. */
  output(callId: string, chunk: string): void {
    this.pending.get(callId)?.onOutput(chunk);
  }

  /** A call finished. Unknown ids are ignored: a late reply is not an error. */
  settle(callId: string, result: HandsResult): void {
    const pending = this.pending.get(callId);
    if (pending === undefined) return;
    this.pending.delete(callId);
    pending.settle(result);
  }

  /** Fails everything a departing terminal was still running. */
  private releaseCalls(connectionId: string): void {
    for (const [callId, pending] of [...this.pending]) {
      if (pending.connectionId !== connectionId) continue;
      this.pending.delete(callId);
      pending.settle({
        ok: false,
        output: '',
        error: 'The terminal disconnected before this finished.',
      });
    }
  }

  /** Every attached terminal, for a status screen or a log line. */
  attached(): HandsMachine[] {
    return [...this.entries.values()].map((entry) => entry.connection.machine);
  }

  /**
   * One beat: ping everyone, and drop whoever has ignored enough of them.
   * Called on a timer by the composition root, so this stays testable.
   */
  beat(): void {
    for (const [id, entry] of [...this.entries]) {
      if (entry.unanswered >= MISSED_PINGS_BEFORE_GONE) {
        this.onJournal?.(
          `popy hands: ${entry.connection.machine.hostname} stopped answering; hands released`,
        );
        // Detach first: closing may re-enter through the transport's own
        // close handler, and a second detach must find nothing to do.
        this.detach(id);
        entry.connection.close();
        continue;
      }
      entry.unanswered += 1;
      entry.connection.send({ kind: 'ping' });
    }
  }
}
