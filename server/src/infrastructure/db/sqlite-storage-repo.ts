import type {
  StorageRepo,
  StorageSlice,
  StorageTotals,
} from '../../application/ports/storage-repo.js';
import type { Db } from './types.js';

/**
 * SQLite adapter for {@link StorageRepo} (docs/specs/Spec-Pop-General.md §14).
 *
 * The index line is measured with `length()` over the blobs rather than
 * guessed from a row count: `length()` on a BLOB is the byte count, which is
 * what a storage screen is asking about.
 */
export class SqliteStorageRepo implements StorageRepo {
  constructor(private readonly db: Db) {}

  totals(): StorageTotals {
    return {
      index: this.slice(
        `SELECT COALESCE(sum(length(vector)), 0) AS bytes, count(*) AS count
           FROM message_embeddings`,
      ),
    };
  }

  private slice(sql: string): StorageSlice {
    const row = this.db.prepare(sql).get() as { bytes: number; count: number };
    return { bytes: row.bytes, count: row.count };
  }
}
