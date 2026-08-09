import type { Attachment, MessageClient } from '../../domain/chat/chat.js';

/** One server-owned follow-up waiting for its conversation to become idle. */
export type QueuedMessageDelivery = 'steer' | 'follow_up';

export interface QueuedMessage {
  id: string;
  chatId: string;
  text: string;
  /** steer joins the live pi loop; follow_up waits for that loop to settle. */
  deliveryMode: QueuedMessageDelivery;
  attachments: Attachment[];
  filePaths: string[];
  client?: MessageClient;
  handsConnectionId?: string;
  createdAt: string;
  updatedAt: string;
}

/** Durable queue boundary. The unique chat id enforces one waiting message. */
export interface QueuedMessageRepo {
  get(chatId: string): QueuedMessage | undefined;
  list(): QueuedMessage[];
  create(message: QueuedMessage): boolean;
  update(message: QueuedMessage): boolean;
  delete(chatId: string): boolean;
}
