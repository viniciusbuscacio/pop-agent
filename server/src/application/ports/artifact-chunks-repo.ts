/** Storage for the semantic index over Files (popy.spec §14). */
export interface ArtifactChunk {
  artifactId: string;
  chunk: number;
  text: string;
  vector: Float32Array;
}

export interface ArtifactChunksRepo {
  /** Replaces a file's chunks wholesale -- re-indexing is idempotent. */
  replaceFor(artifactId: string, chunks: { text: string; vector: Float32Array }[]): void;
  /** Every chunk, for the brute-force search. */
  all(): ArtifactChunk[];
  /** Which artifacts already have chunks, for the boot backfill. */
  indexedArtifactIds(): Set<string>;
}
