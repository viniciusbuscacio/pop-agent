/** A conversation, as the sidebar and the chat header see it. */
export interface ChatDTO {
  id: string;
  title: string;
  /** Empty means "whatever the default model is". */
  model: string;
  /** Empty means "whatever the default provider is" (docs/specs/Spec-Pop-General.md §15). */
  provider: string;
  archived: boolean;
  /** Kept at the top of the list and exempt from bulk archiving. */
  pinned: boolean;
  /** Server-synchronized default for messages sent from this chat. */
  executionMode?: ExecutionMode;
  createdAt: string;
  updatedAt: string;
  /** Last message, for the list. Empty for a chat nobody has written in. */
  preview: string;
}

export interface ChatListResponse {
  chats: ChatDTO[];
}

/** `POST /v1/chats/archive-others` — keep one open and file the rest. */
export interface ArchiveOtherChatsRequest {
  keepChatId: string;
}

export interface ArchiveOtherChatsResponse {
  archived: number;
}

/** `POST /v1/chats/delete-others` — permanently remove open, unpinned chats. */
export interface DeleteOtherChatsRequest {
  keepChatId: string;
}

export interface DeleteOtherChatsResponse {
  deleted: number;
}

/** What a tool call left behind, as rendered in a reloaded conversation. */
export interface ToolCallDTO {
  name: string;
  status: 'start' | 'output' | 'done' | 'error';
  detail: string;
}

export interface ModelAttemptDTO {
  providerId: string;
  modelId: string;
  code: string;
  status?: number;
}

/** Structured detail for actionable system history; content remains the legacy fallback. */
export type SystemNoticeDTO =
  | { kind: 'context-compacted' }
  | {
      kind: 'model-fallback';
      failed: ModelAttemptDTO;
      fallback: { providerId: string; modelId: string };
    }
  | { kind: 'run-failure'; failed: ModelAttemptDTO };

export interface MessageDTO {
  id: string;
  chatId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  thinking: string;
  tools: ToolCallDTO[];
  attachments: AttachmentDTO[];
  createdAt: string;
  notice?: SystemNoticeDTO;
}

/**
 * The run in flight for a chat, as of this response. A client mounting mid-run
 * seeds its live view from this
 * instead of waiting for the next fragment; `seq` says how much of the stream
 * the snapshot already contains, so fragments are never counted twice.
 */
export interface LiveRunDTO {
  runId: string;
  status: 'queued' | 'running';
  /** Sequence number of the last fragment folded into this snapshot. */
  seq: number;
  content: string;
  thinking: string;
  tools: ToolCallDTO[];
}

export type MessageDelivery = 'steer' | 'follow_up';

/** Per-message execution policy. Omitted on the wire means ordinary full access. */
export type ExecutionMode = 'normal' | 'plan';

export interface QueuedMessageDTO {
  id: string;
  chatId: string;
  text: string;
  deliveryMode: MessageDelivery;
  /** Older servers omit this; clients treat omission as normal. */
  executionMode?: ExecutionMode;
  attachments: AttachmentDTO[];
  /** Files already in Files, kept as references until this turn starts. */
  filePaths: string[];
  createdAt: string;
  updatedAt: string;
}

export interface MessagesResponse {
  messages: MessageDTO[];
  /** Present while this chat has a run in flight. */
  live?: LiveRunDTO;
  /** Entire server-owned pending-input FIFO in delivery order. */
  pending?: QueuedMessageDTO[];
  /** Oldest item, retained for compatibility with older clients. */
  queued?: QueuedMessageDTO;
}

/** `PATCH /v1/chats/:id` — send only what changes. */
export type SessionCommandName = 'compact' | 'session' | 'name' | 'export' | 'fork';

export interface SessionCommandRequest {
  command: SessionCommandName;
  argument?: string;
}

export interface SessionForkPointDTO {
  number: number;
  text: string;
}

export interface SessionCommandResponse {
  kind: SessionCommandName;
  message?: string;
  path?: string;
  chat?: ChatDTO;
  draft?: string;
}

export interface PatchChatRequest {
  title?: string;
  archived?: boolean;
  pinned?: boolean;
  model?: string;
  /** Must travel with `model`: the identity is the pair (docs/specs/Spec-Pop-General.md §15). */
  provider?: string;
  executionMode?: ExecutionMode;
}

/**
 * A file sent with a message (docs/specs/Spec-Pop-General.md §6, the API shape). The data URI is the
 * whole payload: stored on the message row, rendered from there, and written
 * into the agent's workspace so its tools can read the file.
 */
export interface AttachmentDTO {
  name: string;
  type: string;
  dataUri: string;
}

/** Body of `POST /v1/chats/:id/messages` (docs/agent-flow.md). */
export interface SendMessageRequest {
  text: string;
  /** Omitted/default steers; /queue sends follow_up. */
  delivery?: MessageDelivery;
  /** Omitted/default is normal. Plan exposes only read-only tools to pi. */
  executionMode?: ExecutionMode;
  attachments?: AttachmentDTO[];
  /** Files already in Files, referenced by @ in the composer, by path. */
  filePaths?: string[];
}

/** 202 response of `POST /v1/chats/:id/messages`: started now, or safely queued. */
export type SendMessageResponse =
  | { queued?: false; runId: string; userMessageId: string }
  | {
      queued: true;
      /** The newly accepted input, used by the sending client for local echo. */
      message: QueuedMessageDTO;
      /** Oldest pending input. Older servers omitted it; clients fall back to message. */
      head?: QueuedMessageDTO;
    };

/** `POST /v1/chats/:id/stop` — false when there was nothing to stop. */
export interface StopRunResponse {
  stopped: boolean;
}

/** `POST /v1/chats/:id/confirm` — answers a paused risky action (docs/specs/Spec-Pop-General.md §10). */
export interface ConfirmRequest {
  runId: string;
  allow: boolean;
}

export interface ConfirmResponse {
  /** False when there was no pending confirmation to answer. */
  answered: boolean;
}
