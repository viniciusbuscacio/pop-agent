import type { Chat, ChatSummary, Message, ToolRecord } from '../../domain/chat/chat.js';
import type { ChatRepo } from '../../application/ports/chat-repo.js';
import type { Db } from './types.js';

/** SQLite adapter for {@link ChatRepo}. */
export class SqliteChatRepo implements ChatRepo {
  constructor(private readonly db: Db) {}

  create(chat: Chat): Chat {
    this.db
      .prepare(
        `INSERT INTO chats (id, title, model, archived, pi_session_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        chat.id,
        chat.title,
        chat.model,
        chat.archived ? 1 : 0,
        chat.piSessionId,
        chat.createdAt,
        chat.updatedAt,
      );
    return chat;
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

  setModel(id: string, model: string): void {
    this.db.prepare('UPDATE chats SET model = ? WHERE id = ?').run(model, id);
  }

  setPiSessionId(id: string, piSessionId: string): void {
    this.db.prepare('UPDATE chats SET pi_session_id = ? WHERE id = ?').run(piSessionId, id);
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
    this.db
      .prepare(
        `INSERT INTO messages
           (id, chat_id, role, content, thinking, tools_json, attachments_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        message.id,
        message.chatId,
        message.role,
        message.content,
        message.thinking,
        JSON.stringify(message.tools),
        JSON.stringify(message.attachments),
        message.createdAt,
      );
    return message;
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

  titles(): string[] {
    const rows = this.db.prepare('SELECT title FROM chats').all() as { title: string }[];
    return rows.map((row) => row.title);
  }
}

interface ChatRow {
  id: string;
  title: string;
  model: string;
  archived: number;
  pi_session_id: string;
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
    archived: row.archived === 1,
    piSessionId: row.pi_session_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    chatId: row.chat_id,
    role: row.role === 'assistant' ? 'assistant' : 'user',
    content: row.content,
    thinking: row.thinking,
    tools: parseJson<ToolRecord[]>(row.tools_json, []),
    attachments: parseJson<string[]>(row.attachments_json, []),
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
