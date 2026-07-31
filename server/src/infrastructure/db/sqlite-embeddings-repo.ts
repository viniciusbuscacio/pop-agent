import type { EmbeddingsRepo, StoredEmbedding } from '../../application/ports/embeddings-repo.js';
import type { Db } from './types.js';

/** SQLite adapter for {@link EmbeddingsRepo}. Vectors are Float32Array BLOBs. */
export class SqliteEmbeddingsRepo implements EmbeddingsRepo {
  constructor(private readonly db: Db) {}

  save(messageRowid: number, vector: Float32Array): void {
    this.db
      .prepare(
        `INSERT INTO message_embeddings (message_rowid, vector) VALUES (?, ?)
         ON CONFLICT(message_rowid) DO UPDATE SET vector = excluded.vector`,
      )
      .run(messageRowid, Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength));
  }

  all(): StoredEmbedding[] {
    const rows = this.db
      .prepare(
        `SELECT e.message_rowid AS rowid, m.chat_id AS chatId, e.vector AS vector
           FROM message_embeddings e
           JOIN messages m ON m.rowid = e.message_rowid`,
      )
      .all() as { rowid: number; chatId: string; vector: Buffer }[];
    return rows.map((row) => ({
      messageRowid: row.rowid,
      chatId: row.chatId,
      vector: toFloat32(row.vector),
    }));
  }

  pending(limit: number): { rowid: number; content: string }[] {
    return this.db
      .prepare(
        `SELECT m.rowid AS rowid, m.content AS content
           FROM messages m
      LEFT JOIN message_embeddings e ON e.message_rowid = m.rowid
          WHERE e.message_rowid IS NULL AND length(m.content) > 0
       ORDER BY m.rowid DESC
          LIMIT ?`,
      )
      .all(limit) as { rowid: number; content: string }[];
  }

  pendingCount(): number {
    const row = this.db
      .prepare(
        `SELECT count(*) AS total
           FROM messages m
      LEFT JOIN message_embeddings e ON e.message_rowid = m.rowid
          WHERE e.message_rowid IS NULL AND length(m.content) > 0`,
      )
      .get() as { total: number };
    return row.total;
  }
}

/** A BLOB back into a Float32Array, copying so it does not alias the buffer. */
function toFloat32(buffer: Buffer): Float32Array {
  const copy = new Uint8Array(buffer.byteLength);
  copy.set(buffer);
  return new Float32Array(copy.buffer);
}
