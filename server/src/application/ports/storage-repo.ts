/**
 * What the database can say about its own weight (pop-agent.spec §14).
 *
 * Bytes that live on disk are measured on disk; this is the one only SQL
 * knows -- how much of the database is derived index rather than anything
 * the user wrote.
 */

export interface StorageSlice {
  bytes: number;
  count: number;
}

export interface StorageTotals {
  /**
   * Derived rows: embeddings for messages. Rebuildable -- losing it costs
   * time, not data -- which is exactly what makes it worth naming separately.
   */
  index: StorageSlice;
}

export interface StorageRepo {
  totals(): StorageTotals;
}
