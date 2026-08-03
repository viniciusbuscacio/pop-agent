import type {
  StorageRepo,
  StorageSlice,
  StorageTotals,
} from '../../application/ports/storage-repo.js';
import type { Db } from './types.js';

/**
 * SQLite adapter for {@link StorageRepo} (popy.spec §14).
 *
 * The index line is measured with `length()` over the blobs and text rather
 * than guessed from a row count: an embedding is a fixed vector, but extracted
 * text is not, and a scanned PDF weighs nothing like a note. `length()` on a
 * BLOB is the byte count, which is what a storage screen is asking about.
 */
export class SqliteStorageRepo implements StorageRepo {
  constructor(private readonly db: Db) {}

  totals(): StorageTotals {
    const files = this.slice(
      `SELECT COALESCE(sum(size), 0) AS bytes, count(*) AS count FROM artifacts`,
    );
    const versions = this.slice(
      `SELECT COALESCE(sum(size), 0) AS bytes, count(*) AS count FROM artifact_versions`,
    );

    // Everything derived, across the three tables that hold it. Each is
    // rebuildable from what the user actually wrote, which is why they are one
    // line here instead of three.
    const chunks = this.slice(
      `SELECT COALESCE(sum(length(text) + length(vector)), 0) AS bytes, count(*) AS count
         FROM artifact_chunks`,
    );
    const messages = this.slice(
      `SELECT COALESCE(sum(length(vector)), 0) AS bytes, count(*) AS count
         FROM message_embeddings`,
    );
    const paths = this.slice(
      `SELECT COALESCE(sum(length(name) + length(path)), 0) AS bytes, count(*) AS count
         FROM path_index`,
    );

    return {
      files,
      versions,
      index: {
        bytes: chunks.bytes + messages.bytes + paths.bytes,
        count: chunks.count + messages.count + paths.count,
      },
    };
  }

  private slice(sql: string): StorageSlice {
    return this.db.prepare(sql).get() as StorageSlice;
  }
}
