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
  setModel(id: string, model: string, provider: string): void;
  setSummary(id: string, summary: string): void;

  /** A manual rename turns auto-titling off; nothing turns it back on today. */
  setAutoTitle(id: string, autoTitle: boolean): void;

  /**
   * Records where pi keeps this conversation's own session file. Popy never
   * reads that file -- it only needs the path to hand back when the chat wakes
   * up on the other side of an idle unload or a restart (popy.spec §5).
   */
  setPiSessionId(id: string, piSessionId: string): void;

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

  /** How many turns the user has taken -- the auto-title cadence counts these. */
  countUserMessages(chatId: string): number;

  /** Titles already in use, so a generated one can be de-duplicated. */
  titles(): string[];
}
