import type { StreamEvent } from '@pop-agent/shared';

/**
 * One run, folded out of the event stream (docs/cli.md, step 2).
 *
 * Pure: events in, a snapshot out, no printing and no I/O. The terminal and
 * the PWA are two views of the same stream, and this is the half that has to
 * agree -- which is why the doc marks it as a candidate to move into
 * `@pop-agent/shared` and be shared with the web store rather than written twice.
 *
 * **Dedupe by `seq`.** A client that reattaches mid-run seeds itself from the
 * `live` snapshot and then keeps receiving from the stream, so the overlap
 * arrives twice; `seq` is what tells the two apart. Out-of-order is not
 * expected on one connection, but a lower `seq` after a higher one is treated
 * as the duplicate it is rather than appended.
 *
 * Events from other runs are ignored outright. Pop Agent has one user and the SSE
 * hub sends everything to everyone (spec §14), so a terminal watching one
 * answer will genuinely see another chat's deltas go past.
 */

export interface RunState {
  runId: string;
  chatId: string;
  /** The answer so far. */
  text: string;
  /** The reasoning so far, when the server is sending it. */
  thinking: string;
  /** Tool calls in the order they started, with their latest status. */
  tools: { name: string; status: 'start' | 'output' | 'done' | 'error'; detail?: string }[];
  /** 'queued' until the engine actually picks the run up. */
  status: 'queued' | 'running' | 'done' | 'error';
  /** Set once the run ends badly; the code the server sent. */
  errorCode?: string;
  /** The title the server chose, when it chose one during this run. */
  title?: string;
}

export function emptyRun(chatId: string, runId: string): RunState {
  return { runId, chatId, text: '', thinking: '', tools: [], status: 'queued' };
}

export class Transcript {
  private highestSeq = -1;
  /** Steering carries the last fragment's seq, so its persisted user id dedupes it. */
  private readonly deliveredSteering = new Set<string>();

  constructor(private state: RunState) {}

  snapshot(): RunState {
    return this.state;
  }

  /** Whether the run has stopped, either way. */
  get finished(): boolean {
    return this.state.status === 'done' || this.state.status === 'error';
  }

  /**
   * Folds one event in. Returns whether anything changed, so a caller can
   * avoid repainting a screen that did not move.
   */
  apply(event: StreamEvent): boolean {
    if (event.kind === 'update' || event.kind === 'queue') return false;
    if (event.chatId !== this.state.chatId) return false;
    // `title` is the one event about the chat rather than a run: it carries no
    // runId, and it arrives while a run is in flight.
    if (event.kind === 'title') {
      this.state = { ...this.state, title: event.title };
      return true;
    }
    if (event.runId !== this.state.runId) return false;

    switch (event.kind) {
      case 'delta':
      case 'thinking':
      case 'tool': {
        if (event.seq <= this.highestSeq) return false;
        this.highestSeq = event.seq;
        if (event.kind === 'delta') {
          this.state = { ...this.state, text: this.state.text + event.text, status: 'running' };
          return true;
        }
        if (event.kind === 'thinking') {
          this.state = {
            ...this.state,
            thinking: this.state.thinking + event.text,
            status: 'running',
          };
          return true;
        }
        return this.applyTool(event.name, event.status, event.detail);
      }
      case 'steering-delivered':
        // Same run, new visible assistant segment. The server persisted the
        // partial segment and the steering user turn before emitting this;
        // fragments after `seq` belong to a fresh accumulator. Its seq equals
        // the latest fragment, so the persisted user id handles SSE overlap.
        if (this.deliveredSteering.has(event.user.id)) return false;
        this.deliveredSteering.add(event.user.id);
        this.highestSeq = Math.max(this.highestSeq, event.seq);
        this.state = {
          ...this.state,
          text: '',
          thinking: '',
          tools: [],
          status: 'running',
        };
        return true;
      case 'run-status':
        this.state = { ...this.state, status: event.status };
        return true;
      case 'done':
        this.state = { ...this.state, status: 'done' };
        return true;
      case 'error':
        this.state = { ...this.state, status: 'error', errorCode: event.code };
        return true;
      // 'confirm' is a run parked on a question. The one-shot client has no
      // way to answer one, so it is left for the TUI (step 4) rather than
      // silently swallowed here.
      default:
        return false;
    }
  }

  private applyTool(
    name: string,
    status: 'start' | 'output' | 'done' | 'error',
    detail: string | undefined,
  ): boolean {
    const tools = [...this.state.tools];
    // The latest call with this name that is still running: a run can call the
    // same tool twice, and the second start must not overwrite the first.
    const index = findLast(tools, (tool) => tool.name === name && tool.status !== 'done' && tool.status !== 'error');
    const entry = { name, status, ...(detail === undefined ? {} : { detail }) };
    if (status === 'start' || index === -1) tools.push(entry);
    else tools[index] = entry;
    this.state = { ...this.state, tools, status: 'running' };
    return true;
  }
}

function findLast<T>(items: T[], match: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index] !== undefined && match(items[index] as T)) return index;
  }
  return -1;
}
