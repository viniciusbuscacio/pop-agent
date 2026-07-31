import type { ToolStatus } from '../../domain/chat/chat.js';

/**
 * What the application broadcasts to whoever is watching (docs/agent-flow.md).
 * The SSE hub in the interface layer is the adapter; it maps these onto the
 * wire DTOs, so the application never learns that HTTP exists.
 */
export type RunEvent =
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
  | { kind: 'error'; chatId: string; runId: string; code: string }
  | { kind: 'title'; chatId: string; title: string }
  /** Whether a run is waiting for a slot or actually talking to the engine. */
  | { kind: 'run-status'; chatId: string; runId: string; status: 'queued' | 'running' };

export interface EventSink {
  emit(event: RunEvent): void;
}
