/**
 * Turning text into a vector for similarity search (popy.spec §7). The model
 * runs locally on the server's CPU; embedding a message costs electricity, not
 * tokens. The e5 family needs a `query:` / `passage:` prefix, which the adapter
 * applies -- callers just say which kind of text this is.
 */
export type EmbeddingKind = 'query' | 'passage';

export interface Embedder {
  /** Embeds each text; the vectors are L2-normalized, so a dot product is cosine. */
  embed(texts: string[], kind: EmbeddingKind): Promise<Float32Array[]>;
  /** The vector length, so a store can size its columns. */
  readonly dimension: number;
}
