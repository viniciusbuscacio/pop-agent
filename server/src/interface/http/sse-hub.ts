import { EVENT_STREAM_VERSION, type StreamEvent } from '@pop-agent/shared';
import type { EventSink, RunEvent } from '../../application/ports/event-sink.js';

/**
 * The SSE hub: the adapter that turns application events into the single
 * stream the browser listens to (docs/agent-flow.md).
 *
 * Pop Agent has one user, so every connection sees everything -- three tabs and a
 * phone all watch the same run. The client already discards events for runs it
 * is not showing, which is the same filter it needs for its own stale runs.
 */

export type Subscriber = (payload: string) => void;

export class SseHub implements EventSink {
  onIntegrationEvent?: (event: RunEvent) => void;
  private readonly subscribers = new Map<Subscriber, number>();

  emit(event: RunEvent): void {
    this.onIntegrationEvent?.(event);
    const wire = toStreamEvent(event);
    const payload = JSON.stringify(wire);
    const requiredVersion = minimumEventVersion(wire);
    for (const [send, eventVersion] of this.subscribers) {
      if (eventVersion < requiredVersion) continue;
      try {
        send(payload);
      } catch {
        // A connection that died between the check and the write is not this
        // broadcast's problem; its own cleanup will remove it.
      }
    }
  }

  /** Registers a connection and returns the function that removes it. */
  subscribe(send: Subscriber, eventVersion = EVENT_STREAM_VERSION): () => void {
    this.subscribers.set(send, eventVersion);
    return () => {
      this.subscribers.delete(send);
    };
  }

  get connectionCount(): number {
    return this.subscribers.size;
  }
}

/** New additive event kinds are withheld from legacy cached web bundles. */
function minimumEventVersion(event: StreamEvent): number {
  return event.kind === 'chat-archived-changed' || event.kind === 'chat-model-changed' ? 2 : 1;
}

/**
 * Explicit mapping to the wire type. The shapes match today; writing it out
 * means the day one of them changes, the compiler says so here instead of the
 * frontend discovering it at runtime.
 */
export function toStreamEvent(event: RunEvent): StreamEvent {
  switch (event.kind) {
    case 'chat-created':
      return {
        kind: 'chat-created',
        chatId: event.chatId,
        chat: {
          id: event.chat.id,
          title: event.chat.title,
          model: event.chat.model,
          provider: event.chat.provider,
          archived: event.chat.archived,
          pinned: event.chat.pinned,
          executionMode: event.chat.executionMode ?? 'normal',
          createdAt: event.chat.createdAt,
          updatedAt: event.chat.updatedAt,
          preview: '',
        },
      };
    case 'chat-deleted':
      return { kind: 'chat-deleted', chatId: event.chatId };
    case 'chat-archived-changed':
      return { kind: 'chat-archived-changed', chatId: event.chatId, archived: event.archived };
    case 'chat-pin-changed':
      return { kind: 'chat-pin-changed', chatId: event.chatId, pinned: event.pinned };
    case 'chat-model-changed':
      return {
        kind: 'chat-model-changed',
        chatId: event.chatId,
        provider: event.provider,
        model: event.model,
      };
    case 'chat-execution-mode-changed':
      return {
        kind: 'chat-execution-mode-changed',
        chatId: event.chatId,
        executionMode: event.executionMode,
      };
    case 'local-machines-changed':
      return { kind: 'local-machines-changed' };
    case 'delta':
      return {
        kind: 'delta',
        chatId: event.chatId,
        runId: event.runId,
        seq: event.seq,
        text: event.text,
      };
    case 'thinking':
      return {
        kind: 'thinking',
        chatId: event.chatId,
        runId: event.runId,
        seq: event.seq,
        text: event.text,
      };
    case 'tool':
      return {
        kind: 'tool',
        chatId: event.chatId,
        runId: event.runId,
        seq: event.seq,
        name: event.name,
        status: event.status,
        detail: event.detail,
      };
    case 'done':
      return { kind: 'done', chatId: event.chatId, runId: event.runId, messageId: event.messageId };
    case 'error':
      return {
        kind: 'error',
        chatId: event.chatId,
        runId: event.runId,
        code: event.code,
        ...(event.message === undefined ? {} : { message: toWireMessage(event.message) }),
      };
    case 'system-message':
      return {
        kind: 'system-message',
        chatId: event.chatId,
        ...(event.runId === undefined ? {} : { runId: event.runId }),
        message: toWireMessage(event.message),
      };
    case 'title':
      return { kind: 'title', chatId: event.chatId, title: event.title };
    case 'run-started':
      return {
        kind: 'run-started',
        chatId: event.chatId,
        runId: event.runId,
        user: toWireMessage(event.user),
      };
    case 'run-status':
      return {
        kind: 'run-status',
        chatId: event.chatId,
        runId: event.runId,
        status: event.status,
      };
    case 'confirm':
      return {
        kind: 'confirm',
        chatId: event.chatId,
        runId: event.runId,
        action: event.action,
        detail: event.detail,
      };
    case 'steering-delivered':
      return {
        kind: 'steering-delivered',
        chatId: event.chatId,
        runId: event.runId,
        seq: event.seq,
        ...(event.assistant === undefined ? {} : { assistant: toWireMessage(event.assistant) }),
        user: toWireMessage(event.user),
      };
    case 'queue':
      return {
        kind: 'queue',
        chatId: event.chatId,
        ...(event.message === undefined
          ? {}
          : {
              message: toWireQueuedMessage(event.message),
            }),
        ...(event.change === undefined
          ? {}
          : event.change.kind === 'remove'
            ? { change: event.change }
            : {
                change: {
                  kind: 'upsert' as const,
                  message: toWireQueuedMessage(event.change.message),
                },
              }),
        ...(event.started === undefined ? {} : { started: event.started }),
      };
  }
}

function toWireMessage(message: import('../../domain/chat/chat.js').Message) {
  return {
    id: message.id,
    chatId: message.chatId,
    role: message.role,
    content: message.content,
    thinking: message.thinking,
    tools: message.tools,
    attachments: message.attachments,
    createdAt: message.createdAt,
    ...(message.notice === undefined ? {} : { notice: message.notice }),
  };
}

function toWireQueuedMessage(message: import('../../application/ports/queued-message-repo.js').QueuedMessage) {
  return {
    id: message.id,
    chatId: message.chatId,
    text: message.text,
    deliveryMode: message.deliveryMode,
    executionMode: message.executionMode,
    attachments: message.attachments,
    filePaths: message.filePaths,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
  };
}
