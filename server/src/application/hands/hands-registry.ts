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

export class HandsRegistry {
  private readonly entries = new Map<string, Entry>();
  /** chatId -> connection id. */
  private readonly owners = new Map<string, string>();

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
