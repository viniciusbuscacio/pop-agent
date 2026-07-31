import type {
  MemoryChatHit,
  MemoryRepo,
  MemorySnippet,
  MemoryTranscriptLine,
  RecentChat,
} from '../../application/ports/memory-repo.js';
import type { Db } from './types.js';

/**
 * SQLite adapter for {@link MemoryRepo}, over the FTS5 index from migration
 * 005. Search is grouped by chat with a handful of snippets each, so the agent
 * gets "these three conversations mentioned it, here" rather than a flat wall
 * of matching lines.
 */

const MAX_SNIPPETS_PER_CHAT = 3;
const DEFAULT_SEARCH_LIMIT = 8;

interface HitRow {
  chat_id: string;
  title: string;
  role: string;
  created_at: string;
  snippet: string;
}

export class SqliteMemoryRepo implements MemoryRepo {
  constructor(private readonly db: Db) {}

  search(query: string, options: { limit?: number } = {}): MemoryChatHit[] {
    const match = toMatchQuery(query);
    if (match === undefined) return [];

    const rows = this.db
      .prepare(
        `SELECT m.chat_id AS chat_id,
                c.title   AS title,
                m.role    AS role,
                m.created_at AS created_at,
                snippet(messages_fts, 0, '[', ']', '…', 12) AS snippet
           FROM messages_fts
           JOIN messages m ON m.rowid = messages_fts.rowid
           JOIN chats c ON c.id = m.chat_id
          WHERE messages_fts MATCH ?
       ORDER BY bm25(messages_fts)
          LIMIT 200`,
      )
      .all(match) as HitRow[];

    const byChat = new Map<string, MemoryChatHit>();
    const limit = options.limit ?? DEFAULT_SEARCH_LIMIT;
    for (const row of rows) {
      let hit = byChat.get(row.chat_id);
      if (hit === undefined) {
        if (byChat.size >= limit) continue;
        hit = { chatId: row.chat_id, title: row.title, snippets: [] };
        byChat.set(row.chat_id, hit);
      }
      if (hit.snippets.length < MAX_SNIPPETS_PER_CHAT) {
        hit.snippets.push(toSnippet(row));
      }
    }
    return [...byChat.values()];
  }

  recentChats(limit: number): RecentChat[] {
    const rows = this.db
      .prepare(
        `SELECT id, title, summary, updated_at
           FROM chats
          WHERE archived = 0
       ORDER BY updated_at DESC, id DESC
          LIMIT ?`,
      )
      .all(limit) as { id: string; title: string; summary: string; updated_at: string }[];
    return rows.map((row) => ({
      chatId: row.id,
      title: row.title,
      summary: row.summary,
      updatedAt: row.updated_at,
    }));
  }

  transcript(chatId: string, limit: number): MemoryTranscriptLine[] {
    const rows = this.db
      .prepare(
        `SELECT role, content, created_at
           FROM messages
          WHERE chat_id = ?
       ORDER BY created_at ASC, rowid ASC
          LIMIT ?`,
      )
      .all(chatId, limit) as { role: string; content: string; created_at: string }[];
    return rows.map((row) => ({
      role: row.role === 'assistant' ? 'assistant' : 'user',
      content: row.content,
      createdAt: row.created_at,
    }));
  }
}

function toSnippet(row: HitRow): MemorySnippet {
  return {
    text: row.snippet,
    role: row.role === 'assistant' ? 'assistant' : 'user',
    createdAt: row.created_at,
  };
}

/**
 * Turns a user's phrase into an FTS5 MATCH query that cannot be a syntax
 * error: every run of word characters becomes a quoted term, joined by OR, so
 * punctuation the user typed never reaches the FTS parser. Empty in, undefined
 * out (nothing to search).
 */
function toMatchQuery(query: string): string | undefined {
  const terms = query.match(/[\p{L}\p{N}]+/gu);
  if (terms === null || terms.length === 0) return undefined;
  return terms.map((term) => `"${term}"`).join(' OR ');
}
