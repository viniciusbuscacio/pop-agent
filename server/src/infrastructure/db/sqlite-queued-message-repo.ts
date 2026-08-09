import type {
  QueuedMessage,
  QueuedMessageRepo,
} from '../../application/ports/queued-message-repo.js';
import type { Attachment, MessageClient } from '../../domain/chat/chat.js';
import type { Db } from './types.js';

interface QueueRow {
  id: string;
  chat_id: string;
  text: string;
  attachments_json: string;
  file_paths_json: string;
  client_json: string | null;
  hands_connection_id: string | null;
  created_at: string;
  updated_at: string;
}

/** SQLite adapter for the one-follow-up-per-chat queue (migration 033). */
export class SqliteQueuedMessageRepo implements QueuedMessageRepo {
  constructor(private readonly db: Db) {}

  get(chatId: string): QueuedMessage | undefined {
    const row = this.db
      .prepare('SELECT * FROM queued_messages WHERE chat_id = ?')
      .get(chatId) as QueueRow | undefined;
    return row === undefined ? undefined : toMessage(row);
  }

  list(): QueuedMessage[] {
    return (this.db
      .prepare('SELECT * FROM queued_messages ORDER BY created_at, rowid')
      .all() as QueueRow[]).map(toMessage);
  }

  create(message: QueuedMessage): boolean {
    const result = this.db
      .prepare(
        `INSERT INTO queued_messages
           (id, chat_id, text, attachments_json, file_paths_json, client_json,
            hands_connection_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(chat_id) DO NOTHING`,
      )
      .run(...values(message));
    return result.changes === 1;
  }

  update(message: QueuedMessage): boolean {
    const result = this.db
      .prepare(
        `UPDATE queued_messages
            SET text = ?, attachments_json = ?, file_paths_json = ?, client_json = ?,
                hands_connection_id = ?, updated_at = ?
          WHERE chat_id = ? AND id = ?`,
      )
      .run(
        message.text,
        JSON.stringify(message.attachments),
        JSON.stringify(message.filePaths),
        message.client === undefined ? null : JSON.stringify(message.client),
        message.handsConnectionId ?? null,
        message.updatedAt,
        message.chatId,
        message.id,
      );
    return result.changes === 1;
  }

  delete(chatId: string): boolean {
    return this.db.prepare('DELETE FROM queued_messages WHERE chat_id = ?').run(chatId).changes === 1;
  }
}

function values(message: QueuedMessage): unknown[] {
  return [
    message.id,
    message.chatId,
    message.text,
    JSON.stringify(message.attachments),
    JSON.stringify(message.filePaths),
    message.client === undefined ? null : JSON.stringify(message.client),
    message.handsConnectionId ?? null,
    message.createdAt,
    message.updatedAt,
  ];
}

function toMessage(row: QueueRow): QueuedMessage {
  const attachments = JSON.parse(row.attachments_json) as Attachment[];
  const filePaths = JSON.parse(row.file_paths_json) as string[];
  const client = row.client_json === null ? undefined : (JSON.parse(row.client_json) as MessageClient);
  return {
    id: row.id,
    chatId: row.chat_id,
    text: row.text,
    attachments,
    filePaths,
    ...(client === undefined ? {} : { client }),
    ...(row.hands_connection_id === null ? {} : { handsConnectionId: row.hands_connection_id }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
