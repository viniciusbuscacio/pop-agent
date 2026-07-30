import type { Chat, ChatSummary, Message } from '../../domain/chat/chat.js';

/**
 * Persistence port for conversations (popy.spec §3). SQLite is one adapter;
 * the use cases never learn which.
 */
export interface ChatRepo {
  create(chat: Chat): Chat;
  get(id: string): Chat | undefined;

  /** Newest activity first, which is the order the sidebar shows. */
  list(options: { archived: boolean }): ChatSummary[];

  rename(id: string, title: string): void;
  setArchived(id: string, archived: boolean): void;
  setModel(id: string, model: string): void;
  delete(id: string): void;

  /**
   * A page of history in ascending order. Without `before` this is the tail of
   * the conversation, which is what opening a chat needs; with it, the page
   * that precedes a known message, which is what scrolling up needs.
   */
  getMessages(chatId: string, options: { before?: string; limit: number }): Message[];

  appendMessage(message: Message): Message;

  /** Marks activity so the list ordering follows the last thing that happened. */
  touch(chatId: string, at: string): void;

  /** True when the title is still the untouched default (drives auto-titling). */
  countMessages(chatId: string): number;

  /** Titles already in use, so a generated one can be de-duplicated. */
  titles(): string[];
}
