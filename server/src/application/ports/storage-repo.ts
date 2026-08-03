/**
 * What the database can say about its own weight (popy.spec §14).
 *
 * Bytes that live on disk are measured on disk; these are the ones only SQL
 * knows -- how much of the artifacts directory is still a live file versus an
 * archived version, and how much of the database is derived index rather than
 * anything the user wrote.
 */

export interface StorageSlice {
  bytes: number;
  count: number;
}

export interface StorageTotals {
  /** Files the Files screen shows: one row per artifact, current version. */
  files: StorageSlice;
  /** Copies kept from earlier overwrites. Nothing ever prunes these today. */
  versions: StorageSlice;
  /**
   * Derived rows: extracted text and embeddings for files, embeddings for
   * messages, and the path index. Rebuildable -- losing it costs time, not
   * data -- which is exactly what makes it worth naming separately.
   */
  index: StorageSlice;
}

export interface StorageRepo {
  totals(): StorageTotals;
}
