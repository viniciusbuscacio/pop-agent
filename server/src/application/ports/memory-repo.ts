/**
 * Reading across every conversation, not just the current one (popy.spec §7).
 * This is what lets the agent answer "what did we decide about X last week?"
 * -- lexical search over all messages, plus the recent chats to offer as a
 * catalog in the system prompt.
 */

export interface MemorySnippet {
  /** A short excerpt of the matching message, with the hit in context. */
  text: string;
  role: 'user' | 'assistant';
  createdAt: string;
}

export interface MemoryChatHit {
  chatId: string;
  title: string;
  /** Up to a few excerpts from this chat, best first. */
  snippets: MemorySnippet[];
}

export interface RecentChat {
  chatId: string;
  title: string;
  summary: string;
  updatedAt: string;
}

export interface MemoryTranscriptLine {
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface MemoryRepo {
  /** Full-text search across all messages, grouped by chat. */
  search(query: string, options?: { limit?: number }): MemoryChatHit[];

  /** The most recently active chats, for the system-prompt catalog. */
  recentChats(limit: number): RecentChat[];

  /** A chat's transcript in order, capped, for `memory_open`. */
  transcript(chatId: string, limit: number): MemoryTranscriptLine[];
}
