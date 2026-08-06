import type {
  FileProvenanceRepo,
  ProvenanceEntry,
} from '../../application/ports/file-provenance-repo.js';
import type { Db } from './types.js';

/** SQLite rows for the provenance log (migration 026). Append-only: no update, no delete. */
export class SqliteFileProvenanceRepo implements FileProvenanceRepo {
  constructor(private readonly db: Db) {}

  record(entry: ProvenanceEntry): void {
    this.db
      .prepare(
        'INSERT INTO file_provenance (id, chat_id, path, created_at) VALUES (?, ?, ?, ?)',
      )
      .run(entry.id, entry.chatId, entry.path, entry.createdAt);
  }

  latestChatFor(path: string): string | undefined {
    const row = this.db
      .prepare(
        'SELECT chat_id FROM file_provenance WHERE path = ? ORDER BY created_at DESC, rowid DESC LIMIT 1',
      )
      .get(path) as { chat_id: string } | undefined;
    return row?.chat_id;
  }

  listByChat(chatId: string): { path: string; createdAt: string }[] {
    const rows = this.db
      .prepare(
        'SELECT path, created_at FROM file_provenance WHERE chat_id = ? ORDER BY created_at DESC, rowid DESC',
      )
      .all(chatId) as { path: string; created_at: string }[];
    return rows.map((row) => ({ path: row.path, createdAt: row.created_at }));
  }
}
