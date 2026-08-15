import type { Attachment, ExecutionMode, MessageClient } from '../../domain/chat/chat.js';

/** One item in the server-owned pending-input FIFO. */
export type QueuedMessageDelivery = 'steer' | 'follow_up';

export interface QueuedMessage {
  id: string;
  chatId: string;
  text: string;
  /** steer joins the live pi loop; follow_up waits for that loop to settle. */
  deliveryMode: QueuedMessageDelivery;
  executionMode: ExecutionMode;
  attachments: Attachment[];
  filePaths: string[];
  client?: MessageClient;
  localConnectionId?: string;
  createdAt: string;
  updatedAt: string;
}

/** Durable FIFO boundary. Items are ordered by creation time, then insertion order. */
export interface QueuedMessageRepo {
  /** Oldest pending item for a chat. */
  get(chatId: string): QueuedMessage | undefined;
  getById(chatId: string, id: string): QueuedMessage | undefined;
  count(chatId: string): number;
  list(chatId?: string): QueuedMessage[];
  create(message: QueuedMessage): boolean;
  update(message: QueuedMessage): boolean;
  /** Deletes exactly one item, never the rest of its chat's FIFO. */
  delete(id: string): boolean;
}
