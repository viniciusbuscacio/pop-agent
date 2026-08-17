import type { Chat, ChatSummary, ExecutionMode, Message } from '../../domain/chat/chat.js';

/**
 * Persistence port for conversations (docs/specs/Spec-Pop-General.md §3). SQLite is one adapter;
 * the use cases never learn which.
 */
export interface ChatRepo {
  create(chat: Chat): Chat;
  get(id: string): Chat | undefined;

  /** Newest activity first, which is the order the sidebar shows. */
  list(options: { archived: boolean }): ChatSummary[];

  rename(id: string, title: string): void;
  setArchived(id: string, archived: boolean): void;
  setPinned(id: string, pinned: boolean): void;
  setExecutionMode(id: string, executionMode: ExecutionMode): void;
  /** Archives every open conversation except the active one and pinned chats. */
  archiveOthers(keepChatId: string): number;
  setModel(id: string, model: string, provider: string): void;
  recordRecentModel(entry: { provider: string; model: string; usedAt: string }): void;
  recentModels(limit: number): { provider: string; model: string; usedAt: string }[];
  setSummary(id: string, summary: string): void;

  /** A manual rename turns auto-titling off; nothing turns it back on today. */
  setAutoTitle(id: string, autoTitle: boolean): void;

  /** Append-only forensic log of every title a chat ever had (docs/specs/Spec-Pop-General.md §14). */
  recordTitle(entry: { chatId: string; title: string; turn: number; source: 'auto' | 'manual'; createdAt: string }): void;

  /**
   * Records where pi keeps this conversation's own session file. Pop Agent never
   * reads that file -- it only needs the path to hand back when the chat wakes
   * up on the other side of an idle unload or a restart (docs/specs/Spec-Pop-General.md §5).
   */
  setPiSessionId(id: string, piSessionId: string): void;

  delete(id: string): void;

  /**
   * A page of history in ascending order. Without `before` this is the tail of
   * the conversation, which is what opening a chat needs; with it, the page
   * that precedes a known message, which is what scrolling up needs.
   */
  getMessages(chatId: string, options: { before?: string; limit: number }): Message[];

  /** A bounded historical window, used to repeat one exact distillation attempt. */
  getMessageRange(
    chatId: string,
    options: { after?: string; through: string; limit: number },
  ): Message[];

  /**
   * The newest message id of every chat, in one query (docs/specs/Spec-Pop-General.md §8, fase
   * c). The distiller's tick compares these against its watermarks to find the
   * chats worth opening at all -- the idle answer is almost always "nothing
   * new anywhere", and learning that used to cost one tail-read per chat.
   */
  lastMessageIds(): { chatId: string; lastMessageId?: string }[];

  appendMessage(message: Message): Message;

  /** Marks activity so the list ordering follows the last thing that happened. */
  touch(chatId: string, at: string): void;

  /** True when the title is still the untouched default (drives auto-titling). */
  countMessages(chatId: string): number;
  /**
   * Which client the last user message in this chat came through, or
   * undefined when there is none or it predates the field. Read before the
   * new message is stored, so the service can tell a change from a repeat.
   */
  lastClientKind(chatId: string): string | undefined;

  /** How many turns the user has taken -- the auto-title cadence counts these. */
  countUserMessages(chatId: string): number;

  /** Titles already in use, so a generated one can be de-duplicated. */
  titles(): string[];
}
