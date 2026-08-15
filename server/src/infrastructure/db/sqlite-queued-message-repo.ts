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
  delivery_mode: 'steer' | 'follow_up';
  execution_mode: 'normal' | 'plan';
  attachments_json: string;
  file_paths_json: string;
  client_json: string | null;
  local_connection_id: string | null;
  created_at: string;
  updated_at: string;
}

/** SQLite adapter for the per-chat pending-input FIFO. */
export class SqliteQueuedMessageRepo implements QueuedMessageRepo {
  constructor(private readonly db: Db) {}

  get(chatId: string): QueuedMessage | undefined {
    const row = this.db
      .prepare('SELECT * FROM queued_messages WHERE chat_id = ? ORDER BY created_at, rowid LIMIT 1')
      .get(chatId) as QueueRow | undefined;
    return row === undefined ? undefined : toMessage(row);
  }

  getById(chatId: string, id: string): QueuedMessage | undefined {
    const row = this.db
      .prepare('SELECT * FROM queued_messages WHERE chat_id = ? AND id = ?')
      .get(chatId, id) as QueueRow | undefined;
    return row === undefined ? undefined : toMessage(row);
  }

  count(chatId: string): number {
    return (this.db
      .prepare('SELECT COUNT(*) AS count FROM queued_messages WHERE chat_id = ?')
      .get(chatId) as { count: number }).count;
  }

  list(chatId?: string): QueuedMessage[] {
    const rows = chatId === undefined
      ? this.db.prepare('SELECT * FROM queued_messages ORDER BY created_at, rowid').all()
      : this.db
          .prepare('SELECT * FROM queued_messages WHERE chat_id = ? ORDER BY created_at, rowid')
          .all(chatId);
    return (rows as QueueRow[]).map(toMessage);
  }

  create(message: QueuedMessage): boolean {
    const result = this.db
      .prepare(
        `INSERT INTO queued_messages
           (id, chat_id, text, delivery_mode, execution_mode, attachments_json, file_paths_json,
            client_json, local_connection_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
      )
      .run(...values(message));
    return result.changes === 1;
  }

  update(message: QueuedMessage): boolean {
    const result = this.db
      .prepare(
        `UPDATE queued_messages
            SET text = ?, delivery_mode = ?, execution_mode = ?, attachments_json = ?, file_paths_json = ?, client_json = ?,
                local_connection_id = ?, updated_at = ?
          WHERE chat_id = ? AND id = ?`,
      )
      .run(
        message.text,
        message.deliveryMode,
        message.executionMode,
        JSON.stringify(message.attachments),
        JSON.stringify(message.filePaths),
        message.client === undefined ? null : JSON.stringify(message.client),
        message.localConnectionId ?? null,
        message.updatedAt,
        message.chatId,
        message.id,
      );
    return result.changes === 1;
  }

  delete(id: string): boolean {
    return this.db.prepare('DELETE FROM queued_messages WHERE id = ?').run(id).changes === 1;
  }
}

function values(message: QueuedMessage): unknown[] {
  return [
    message.id,
    message.chatId,
    message.text,
    message.deliveryMode,
    message.executionMode,
    JSON.stringify(message.attachments),
    JSON.stringify(message.filePaths),
    message.client === undefined ? null : JSON.stringify(message.client),
    message.localConnectionId ?? null,
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
    deliveryMode: row.delivery_mode,
    executionMode: row.execution_mode,
    attachments,
    filePaths,
    ...(client === undefined ? {} : { client }),
    ...(row.local_connection_id === null ? {} : { localConnectionId: row.local_connection_id }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
