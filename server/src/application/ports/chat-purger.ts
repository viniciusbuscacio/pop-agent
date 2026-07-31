import type { Chat } from '../../domain/chat/chat.js';

/**
 * Removes everything a chat left outside the database (popy.spec §6): pi's
 * JSONL session file and the chat's attachment directory. The SQLite rows go
 * by cascade; this is the rest, so deleting a conversation leaves no orphans.
 */
export interface ChatPurger {
  purge(chat: Chat): void;
}
