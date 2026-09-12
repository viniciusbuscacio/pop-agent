import type { AttachmentCatalogRepo, AttachmentRecord } from '../../application/ports/attachment-catalog-repo.js';
import type { Db } from './types.js';
const normalize = (value: string): string => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const columns = 'path, chat_id AS chatId, message_id AS messageId, name, type, subject, description, created_at AS createdAt';
export class SqliteAttachmentCatalogRepo implements AttachmentCatalogRepo {
  constructor(private readonly db: Db) {}
  put(record: AttachmentRecord): void {
    this.db.prepare(`INSERT INTO attachment_catalog VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET subject=excluded.subject, description=excluded.description, search_text=excluded.search_text`)
      .run(record.path, record.chatId, record.messageId, record.name, record.type, record.subject, record.description, record.createdAt,
        normalize(`${record.name} ${record.subject} ${record.description}`));
  }
  get(path: string): AttachmentRecord | undefined {
    return this.db.prepare(`SELECT ${columns} FROM attachment_catalog WHERE path=?`).get(path) as AttachmentRecord | undefined;
  }
  search(query: string, limit: number): AttachmentRecord[] {
    const words = normalize(query.slice(0, 300)).trim().split(/\s+/u).filter(Boolean).slice(0, 12);
    if (!words.length) return [];
    return this.db.prepare(`SELECT ${columns} FROM attachment_catalog WHERE ${words.map(() => "search_text LIKE ? ESCAPE '\\'").join(' AND ')} ORDER BY created_at DESC LIMIT ?`)
      .all(...words.map(word => `%${word.replace(/[\\%_]/gu, '\\$&')}%`), Math.max(1, Math.min(200, limit))) as AttachmentRecord[];
  }
}
