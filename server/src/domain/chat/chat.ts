/**
 * The chat entities (pop-agent.spec §6). Plain data owned by the domain: the
 * application layer works with these, and the interface layer maps them to the
 * wire DTOs, so renaming a field here never silently reshapes the API.
 */

export interface Chat {
  id: string;
  title: string;
  /** Model id chosen for this conversation; empty means "the default". */
  model: string;
  /**
   * Provider half of the model identity pair (pop-agent.spec §15); empty means
   * "the default provider". Meaningful whenever `model` is.
   */
  provider: string;
  archived: boolean;
  /** Path to pi's JSONL session. Empty until a real agent run happens. */
  piSessionId: string;
  /** Written by the service model with the title; Phase 4's memory reads it. */
  summary: string;
  /** False after a manual rename: the machine stops renaming this chat. */
  autoTitle: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A chat plus what the list needs to show without loading its messages. */
export interface ChatSummary extends Chat {
  preview: string;
}

export type MessageRole = 'user' | 'assistant' | 'system';

export type ToolStatus = 'start' | 'output' | 'done' | 'error';

/** What a tool call left behind, as rendered in a reloaded conversation. */
export interface ToolRecord {
  name: string;
  status: ToolStatus;
  detail: string;
}

/**
 * A file sent with a message (pop-agent.spec §6, aw's shape). The data URI is the
 * payload itself -- stored with the message, rendered from there, and written
 * into the agent's workspace so its tools can open the file.
 */
export interface Attachment {
  name: string;
  type: string;
  dataUri: string;
}

export interface Message {
  id: string;
  chatId: string;
  role: MessageRole;
  content: string;
  /** Reasoning that preceded the answer; empty for user messages. */
  thinking: string;
  tools: ToolRecord[];
  attachments: Attachment[];
  createdAt: string;
  /**
   * Which client the user sent this from (pop-agent.spec §13). Absent on every
   * assistant and system message -- those are born on the server -- and on
   * anything written before the field existed, where a value would be a guess
   * recorded as a fact.
   */
  client?: MessageClient;
}

/** Where a message came from. `ip` is for audit and never reaches the model. */
export interface MessageClient {
  kind: string;
  platform?: string;
  ip?: string;
}

export const DEFAULT_CHAT_TITLE = 'New chat';
