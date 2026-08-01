import type { Attachment, Chat, ChatSummary, Message, ToolRecord } from '../../domain/chat/chat.js';
import type { ChatRepo } from '../../application/ports/chat-repo.js';
import { entityId } from '../../domain/ids.js';
import type { Db } from './types.js';

/**
 * A primary-key collision is astronomically unlikely with 65-bit ids, but the
 * behaviour is defined (popy.spec §6): re-draw the id and try once more rather
 * than fail the request or overwrite. One retry is plenty.
 */
function isPrimaryKeyCollision(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error as { code?: string }).code === 'SQLITE_CONSTRAINT_PRIMARYKEY'
  );
}

/** SQLite adapter for {@link ChatRepo}. */
export class SqliteChatRepo implements ChatRepo {
  constructor(private readonly db: Db) {}

  create(chat: Chat): Chat {
    const insert = this.db.prepare(
      `INSERT INTO chats
         (id, title, model, provider, archived, pi_session_id, summary, auto_title, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    let current = chat;
    for (let attempt = 0; ; attempt += 1) {
      try {
        insert.run(
          current.id,
          current.title,
          current.model,
          current.provider,
          current.archived ? 1 : 0,
          current.piSessionId,
          current.summary,
          current.autoTitle ? 1 : 0,
          current.createdAt,
          current.updatedAt,
        );
        return current;
      } catch (error) {
        if (attempt >= 1 || !isPrimaryKeyCollision(error)) throw error;
        current = { ...current, id: entityId('chat') };
      }
    }
  }

  get(id: string): Chat | undefined {
    const row = this.db.prepare('SELECT * FROM chats WHERE id = ?').get(id) as ChatRow | undefined;
    return row === undefined ? undefined : toChat(row);
  }

  list(options: { archived: boolean }): ChatSummary[] {
    // The preview comes from a correlated subquery rather than a second round
    // trip per chat: the list is the first thing the app renders.
    const rows = this.db
      .prepare(
        `SELECT c.*,
                COALESCE((SELECT m.content FROM messages m
                           WHERE m.chat_id = c.id
                        ORDER BY m.created_at DESC, m.rowid DESC
                           LIMIT 1), '') AS preview
           FROM chats c
          WHERE c.archived = ?
       ORDER BY c.updated_at DESC, c.id DESC`,
      )
      .all(options.archived ? 1 : 0) as (ChatRow & { preview: string })[];

    return rows.map((row) => ({ ...toChat(row), preview: row.preview }));
  }

  rename(id: string, title: string): void {
    this.db.prepare('UPDATE chats SET title = ? WHERE id = ?').run(title, id);
  }

  setArchived(id: string, archived: boolean): void {
    this.db.prepare('UPDATE chats SET archived = ? WHERE id = ?').run(archived ? 1 : 0, id);
  }

  setModel(id: string, model: string, provider: string): void {
    this.db.prepare('UPDATE chats SET model = ?, provider = ? WHERE id = ?').run(model, provider, id);
  }

  setPiSessionId(id: string, piSessionId: string): void {
    this.db.prepare('UPDATE chats SET pi_session_id = ? WHERE id = ?').run(piSessionId, id);
  }

  recordTitle(entry: { chatId: string; title: string; turn: number; source: 'auto' | 'manual'; createdAt: string }): void {
    this.db
      .prepare('INSERT INTO chat_titles (chat_id, title, turn, source, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(entry.chatId, entry.title, entry.turn, entry.source, entry.createdAt);
  }

  setSummary(id: string, summary: string): void {
    this.db.prepare('UPDATE chats SET summary = ? WHERE id = ?').run(summary, id);
  }

  setAutoTitle(id: string, autoTitle: boolean): void {
    this.db.prepare('UPDATE chats SET auto_title = ? WHERE id = ?').run(autoTitle ? 1 : 0, id);
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM chats WHERE id = ?').run(id);
  }

  getMessages(chatId: string, options: { before?: string; limit: number }): Message[] {
    // Read backwards from the newest, then flip: a chat opens at its tail, and
    // scrolling up asks for the page before a message it already has.
    //
    // Ties on created_at are broken by rowid -- insertion order. Two messages
    // written in the same millisecond (a question and a fast answer) must come
    // back in the order they happened, and ids are random, so they cannot be
    // the tiebreaker.
    const rows =
      options.before === undefined
        ? (this.db
            .prepare(
              `SELECT * FROM messages WHERE chat_id = ?
            ORDER BY created_at DESC, rowid DESC LIMIT ?`,
            )
            .all(chatId, options.limit) as MessageRow[])
        : (this.db
            .prepare(
              `SELECT * FROM messages
                WHERE chat_id = ?
                  AND (created_at, rowid)
                      < (SELECT created_at, rowid FROM messages WHERE id = ?)
             ORDER BY created_at DESC, rowid DESC LIMIT ?`,
            )
            .all(chatId, options.before, options.limit) as MessageRow[]);

    return rows.reverse().map(toMessage);
  }

  appendMessage(message: Message): Message {
    const insert = this.db.prepare(
      `INSERT INTO messages
         (id, chat_id, role, content, thinking, tools_json, attachments_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    let current = message;
    for (let attempt = 0; ; attempt += 1) {
      try {
        insert.run(
          current.id,
          current.chatId,
          current.role,
          current.content,
          current.thinking,
          JSON.stringify(current.tools),
          JSON.stringify(current.attachments),
          current.createdAt,
        );
        return current;
      } catch (error) {
        if (attempt >= 1 || !isPrimaryKeyCollision(error)) throw error;
        current = { ...current, id: entityId('message') };
      }
    }
  }

  touch(chatId: string, at: string): void {
    this.db.prepare('UPDATE chats SET updated_at = ? WHERE id = ?').run(at, chatId);
  }

  countMessages(chatId: string): number {
    const row = this.db
      .prepare('SELECT count(*) AS total FROM messages WHERE chat_id = ?')
      .get(chatId) as { total: number };
    return row.total;
  }

  countUserMessages(chatId: string): number {
    const row = this.db
      .prepare(`SELECT count(*) AS total FROM messages WHERE chat_id = ? AND role = 'user'`)
      .get(chatId) as { total: number };
    return row.total;
  }

  titles(): string[] {
    const rows = this.db.prepare('SELECT title FROM chats').all() as { title: string }[];
    return rows.map((row) => row.title);
  }
}

interface ChatRow {
  id: string;
  title: string;
  model: string;
  provider: string;
  archived: number;
  pi_session_id: string;
  summary: string;
  auto_title: number;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: string;
  chat_id: string;
  role: string;
  content: string;
  thinking: string;
  tools_json: string;
  attachments_json: string;
  created_at: string;
}

function toChat(row: ChatRow): Chat {
  return {
    id: row.id,
    title: row.title,
    model: row.model,
    provider: row.provider ?? '',
    archived: row.archived === 1,
    piSessionId: row.pi_session_id,
    summary: row.summary,
    autoTitle: row.auto_title === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    chatId: row.chat_id,
    role: row.role === 'assistant' ? 'assistant' : row.role === 'system' ? 'system' : 'user',
    content: row.content,
    thinking: row.thinking,
    tools: parseJson<ToolRecord[]>(row.tools_json, []),
    attachments: parseJson<Attachment[]>(row.attachments_json, []),
    createdAt: row.created_at,
  };
}

/** A corrupt row must not take the whole conversation down with it. */
function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
