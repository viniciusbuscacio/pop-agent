import type { StreamEvent } from '@popy/shared';
import type { EventSink, RunEvent } from '../../application/ports/event-sink.js';

/**
 * The SSE hub: the adapter that turns application events into the single
 * stream the browser listens to (docs/agent-flow.md).
 *
 * Popy has one user, so every connection sees everything -- three tabs and a
 * phone all watch the same run. The client already discards events for runs it
 * is not showing, which is the same filter it needs for its own stale runs.
 */

export type Subscriber = (payload: string) => void;

export class SseHub implements EventSink {
  private readonly subscribers = new Set<Subscriber>();

  emit(event: RunEvent): void {
    const payload = JSON.stringify(toStreamEvent(event));
    for (const send of this.subscribers) {
      try {
        send(payload);
      } catch {
        // A connection that died between the check and the write is not this
        // broadcast's problem; its own cleanup will remove it.
      }
    }
  }

  /** Registers a connection and returns the function that removes it. */
  subscribe(send: Subscriber): () => void {
    this.subscribers.add(send);
    return () => {
      this.subscribers.delete(send);
    };
  }

  get connectionCount(): number {
    return this.subscribers.size;
  }
}

/**
 * Explicit mapping to the wire type. The shapes match today; writing it out
 * means the day one of them changes, the compiler says so here instead of the
 * frontend discovering it at runtime.
 */
export function toStreamEvent(event: RunEvent): StreamEvent {
  switch (event.kind) {
    case 'delta':
      return { kind: 'delta', chatId: event.chatId, runId: event.runId, text: event.text };
    case 'thinking':
      return { kind: 'thinking', chatId: event.chatId, runId: event.runId, text: event.text };
    case 'tool':
      return {
        kind: 'tool',
        chatId: event.chatId,
        runId: event.runId,
        name: event.name,
        status: event.status,
        detail: event.detail,
      };
    case 'done':
      return { kind: 'done', chatId: event.chatId, runId: event.runId, messageId: event.messageId };
    case 'error':
      return { kind: 'error', chatId: event.chatId, runId: event.runId, code: event.code };
    case 'title':
      return { kind: 'title', chatId: event.chatId, title: event.title };
    case 'run-status':
      return {
        kind: 'run-status',
        chatId: event.chatId,
        runId: event.runId,
        status: event.status,
      };
  }
}
