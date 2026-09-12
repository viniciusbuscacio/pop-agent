import type { Attachment, Message, ToolRecord } from '../../domain/chat/chat.js';
import type {
  RunJournalEntry,
  RunJournalRepo,
  RunProjection,
} from '../../application/ports/run-journal-repo.js';
import type { Db } from './types.js';

interface JournalRow {
  run_id: string;
  chat_id: string;
  user_message_id: string;
  state: 'queued' | 'running';
  prompt: string;
  model: string;
  provider: string;
  attachments_json: string;
  notify: number;
  local_connection_id: string | null;
  execution_mode: 'normal' | 'plan';
  seq: number;
  content: string;
  thinking: string;
  tools_json: string;
  created_at: string;
  updated_at: string;
}

/** SQLite transaction adapter for the application-owned run journal port. */
export class SqliteRunJournalRepo implements RunJournalRepo {
  constructor(private readonly db: Db) {}

  list(): RunJournalEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM chat_run_journal ORDER BY created_at, rowid')
      .all() as JournalRow[];
    return rows.map(toEntry);
  }

  admit(entry: RunJournalEntry, user: Message, consumedQueuedMessageId?: string): Message {
    return this.db.transaction(() => {
      insertMessage(this.db, user);
      this.db
        .prepare(
          `INSERT INTO chat_run_journal
             (run_id, chat_id, user_message_id, state, prompt, model, provider,
              attachments_json, notify, local_connection_id, execution_mode,
              seq, content, thinking, tools_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          entry.runId, entry.chatId, entry.userMessageId, entry.state, entry.prompt,
          entry.model, entry.provider, JSON.stringify(entry.attachments), entry.notify ? 1 : 0,
          entry.localConnectionId ?? null, entry.executionMode, entry.seq, entry.content,
          entry.thinking, JSON.stringify(entry.tools), entry.createdAt, entry.updatedAt,
        );
      if (consumedQueuedMessageId !== undefined) {
        this.db.prepare('DELETE FROM queued_messages WHERE id = ?').run(consumedQueuedMessageId);
      }
      this.db.prepare('UPDATE chats SET updated_at = ? WHERE id = ?').run(entry.updatedAt, entry.chatId);
      return user;
    })();
  }

  markRunning(runId: string, at: string): boolean {
    return this.db
      .prepare(
        `UPDATE chat_run_journal SET state = 'running', updated_at = ?
          WHERE run_id = ? AND state = 'queued'`,
      )
      .run(at, runId).changes === 1;
  }

  saveProjection(runId: string, projection: RunProjection, at: string): boolean {
    return this.db
      .prepare(
        `UPDATE chat_run_journal
            SET seq = ?, content = ?, thinking = ?, tools_json = ?, updated_at = ?
          WHERE run_id = ? AND state = 'running'`,
      )
      .run(
        projection.seq, projection.content, projection.thinking,
        JSON.stringify(projection.tools), at, runId,
      ).changes === 1;
  }

  commitSteeringSegment(
    runId: string,
    steeringId: string,
    messages: Message[],
    at: string,
  ): boolean {
    return this.db.transaction(() => {
      const row = this.db
        .prepare("SELECT chat_id FROM chat_run_journal WHERE run_id = ? AND state = 'running'")
        .get(runId) as { chat_id: string } | undefined;
      if (row === undefined) return false;
      for (const message of messages) insertMessage(this.db, message);
      this.db.prepare('DELETE FROM queued_messages WHERE id = ?').run(steeringId);
      this.db
        .prepare(
          `UPDATE chat_run_journal
              SET content = '', thinking = '', tools_json = '[]', updated_at = ?
            WHERE run_id = ?`,
        )
        .run(at, runId);
      this.db.prepare('UPDATE chats SET updated_at = ? WHERE id = ?').run(at, row.chat_id);
      return true;
    })();
  }

  settle(runId: string, messages: Message[], at: string): boolean {
    return this.db.transaction(() => {
      const row = this.db
        .prepare('SELECT chat_id FROM chat_run_journal WHERE run_id = ?')
        .get(runId) as { chat_id: string } | undefined;
      if (row === undefined) return false;
      for (const message of messages) insertMessage(this.db, message);
      this.db.prepare('UPDATE chats SET updated_at = ? WHERE id = ?').run(at, row.chat_id);
      this.db.prepare('DELETE FROM chat_run_journal WHERE run_id = ?').run(runId);
      return true;
    })();
  }
}

function insertMessage(db: Db, message: Message): void {
  db.prepare(
    `INSERT INTO messages
       (id, chat_id, role, content, thinking, tools_json, attachments_json, created_at,
        client, client_platform, client_ip, notice_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    message.id, message.chatId, message.role, message.content, message.thinking,
    JSON.stringify(message.tools), JSON.stringify(message.attachments), message.createdAt,
    message.client?.kind ?? null, message.client?.platform ?? null, message.client?.ip ?? null,
    JSON.stringify(message.notice ?? {}),
  );
}

function toEntry(row: JournalRow): RunJournalEntry {
  return {
    runId: row.run_id,
    chatId: row.chat_id,
    userMessageId: row.user_message_id,
    state: row.state,
    prompt: row.prompt,
    model: row.model,
    provider: row.provider,
    attachments: parseJson<Attachment[]>(row.attachments_json, []),
    notify: row.notify === 1,
    ...(row.local_connection_id === null ? {} : { localConnectionId: row.local_connection_id }),
    executionMode: row.execution_mode,
    seq: row.seq,
    content: row.content,
    thinking: row.thinking,
    tools: parseJson<ToolRecord[]>(row.tools_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
