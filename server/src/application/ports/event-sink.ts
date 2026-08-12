import type { Chat, Message, ToolStatus } from '../../domain/chat/chat.js';
import type { QueuedMessage } from './queued-message-repo.js';

/**
 * What the application broadcasts to whoever is watching (docs/agent-flow.md).
 * The SSE hub in the interface layer is the adapter; it maps these onto the
 * wire DTOs, so the application never learns that HTTP exists.
 */
export type RunEvent =
  /** A conversation was durably created, whichever client or task opened it. */
  | { kind: 'chat-created'; chatId: string; chat: Chat }
  /** A conversation was durably deleted and must disappear from every client. */
  | { kind: 'chat-deleted'; chatId: string }
  | { kind: 'delta'; chatId: string; runId: string; seq: number; text: string }
  | { kind: 'thinking'; chatId: string; runId: string; seq: number; text: string }
  | {
      kind: 'tool';
      chatId: string;
      runId: string;
      seq: number;
      name: string;
      status: ToolStatus;
      detail: string;
    }
  | { kind: 'done'; chatId: string; runId: string; messageId: string }
  | { kind: 'error'; chatId: string; runId: string; code: string; message?: Message }
  /** A persisted fallback marker sent while the replacement attempt is running. */
  | { kind: 'system-message'; chatId: string; runId: string; message: Message }
  | { kind: 'title'; chatId: string; title: string }
  /** A persisted user turn opened a run, whichever client sent it. */
  | { kind: 'run-started'; chatId: string; runId: string; user: Message }
  /** Whether a run is waiting for a slot or actually talking to the engine. */
  | { kind: 'run-status'; chatId: string; runId: string; status: 'queued' | 'running' }
  /** A risky action is paused, waiting for the user to allow or deny it. */
  | { kind: 'confirm'; chatId: string; runId: string; action: string; detail: string }
  /** Pi consumed a steering input: close the old assistant segment and continue the same run. */
  | {
      kind: 'steering-delivered';
      chatId: string;
      runId: string;
      seq: number;
      assistant?: Message;
      user: Message;
    }
  /** The durable follow-up changed; `started` carries its user bubble to every client. */
  | {
      kind: 'queue';
      chatId: string;
      message?: QueuedMessage;
      change?: { kind: 'upsert'; message: QueuedMessage } | { kind: 'remove'; id: string };
      started?: {
        runId: string;
        userMessageId: string;
        text: string;
        attachments: QueuedMessage['attachments'];
        createdAt: string;
      };
    };

export interface EventSink {
  emit(event: RunEvent): void;
}
