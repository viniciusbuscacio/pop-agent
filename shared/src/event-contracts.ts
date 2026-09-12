import type {
  AttachmentDTO,
  ChatDTO,
  ExecutionMode,
  MessageDTO,
  QueuedMessageDTO,
} from './chat-contracts.js';
export interface EventTicketResponse {
  ticket: string;
}

/** Process-scoped revisions, not an event log or authorization grant. */
export interface SyncManifestResponse {
  epoch: string;
  revisions: Record<string, number>;
}

/**
 * Events delivered over the single SSE channel `GET /v1/events`. Fragments
 * (`delta`, `thinking`, `tool`) carry a per-run `seq` so a client holding a
 * live snapshot can drop what the snapshot already contains.
 */
export type StreamEvent =
  | { kind: 'resources-changed'; keys: string[] }
  | { kind: 'chat-created'; chatId: string; chat: ChatDTO }
  | { kind: 'chat-deleted'; chatId: string }
  | { kind: 'chat-archived-changed'; chatId: string; archived: boolean }
  | { kind: 'chat-pin-changed'; chatId: string; pinned: boolean }
  | { kind: 'chat-model-changed'; chatId: string; provider: string; model: string }
  | { kind: 'chat-execution-mode-changed'; chatId: string; executionMode: ExecutionMode }
  | { kind: 'local-machines-changed' }
  | { kind: 'delta'; chatId: string; runId: string; seq: number; text: string }
  | { kind: 'thinking'; chatId: string; runId: string; seq: number; text: string }
  | {
      kind: 'tool';
      chatId: string;
      runId: string;
      seq: number;
      name: string;
      status: 'start' | 'output' | 'done' | 'error';
      detail?: string;
    }
  | { kind: 'done'; chatId: string; runId: string; messageId: string }
  | { kind: 'error'; chatId: string; runId: string; code: string; message?: MessageDTO }
  /** A durable timeline marker, optionally associated with a live run. */
  | { kind: 'system-message'; chatId: string; runId?: string; message: MessageDTO }
  | { kind: 'title'; chatId: string; title: string }
  /** A persisted user turn opened a run, whichever client sent it. */
  | { kind: 'run-started'; chatId: string; runId: string; user: MessageDTO }
  /** A risky action is paused mid-run, waiting for Allow or Deny (docs/specs/Spec-Pop-General.md §10). */
  | { kind: 'confirm'; chatId: string; runId: string; action: string; detail: string }
  /** Whether a run is waiting for a slot or actually talking to the engine. */
  | { kind: 'run-status'; chatId: string; runId: string; status: 'queued' | 'running' }
  /** A steering input split one live run into two visible assistant segments. */
  | {
      kind: 'steering-delivered';
      chatId: string;
      runId: string;
      seq: number;
      assistant?: MessageDTO;
      user: MessageDTO;
    }
  /** The durable follow-up changed; `started` carries its user bubble into every client. */
  | {
      kind: 'queue';
      chatId: string;
      message?: QueuedMessageDTO;
      /** Incremental FIFO change; `message` remains the current head for older clients. */
      change?: { kind: 'upsert'; message: QueuedMessageDTO } | { kind: 'remove'; id: string };
      started?: { runId: string; userMessageId: string; text: string; attachments: AttachmentDTO[]; createdAt: string };
    };
