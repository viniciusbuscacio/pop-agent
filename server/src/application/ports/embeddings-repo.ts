/**
 * Storage for message embeddings (docs/specs/Spec-Pop-General.md §7). The rowid ties a vector to its
 * message so it drops by cascade on delete; the vectors are loaded whole for a
 * brute-force cosine search.
 */

export interface StoredEmbedding {
  /** The message's rowid, and the chat it belongs to for grouping results. */
  messageRowid: number;
  chatId: string;
  vector: Float32Array;
}

export interface EmbeddingsRepo {
  /** Saves (or replaces) a message's vector. */
  save(messageRowid: number, vector: Float32Array): void;

  /** Every stored vector with its chat, for the in-memory cosine search. */
  all(): StoredEmbedding[];

  /** Message rowids that have no embedding yet, for the backfill. */
  pending(limit: number): { rowid: number; content: string }[];

  /** How many messages still lack an embedding. */
  pendingCount(): number;
}
