import type { Embedder } from '../ports/embedder.js';
import type { EmbeddingsRepo } from '../ports/embeddings-repo.js';

/**
 * Keeps the embedding index trailing the messages (pop-agent.spec §7). Embedding is
 * never on the path of a reply: a finished run hands its rowids here and moves
 * on, and a boot backfill catches whatever was written while there was no
 * embedder (or an older Pop Agent). One at a time, so the model is not asked to run
 * a dozen batches at once on a small server.
 */

const BACKFILL_BATCH = 32;

export interface EmbeddingIndexerDeps {
  embeddings: EmbeddingsRepo;
  embedder: Embedder;
  onError?: (message: string) => void;
}

export class EmbeddingIndexer {
  private working = false;

  constructor(private readonly deps: EmbeddingIndexerDeps) {}

  /** Embeds a batch of message rowids now (used by the run service, fire-and-forget). */
  async index(rows: { rowid: number; content: string }[]): Promise<void> {
    const usable = rows.filter((row) => row.content.length > 0);
    if (usable.length === 0) return;
    try {
      const vectors = await this.deps.embedder.embed(
        usable.map((row) => row.content),
        'passage',
      );
      usable.forEach((row, index) => {
        const vector = vectors[index];
        if (vector !== undefined) this.deps.embeddings.save(row.rowid, vector);
      });
    } catch (error) {
      this.deps.onError?.(error instanceof Error ? error.message : 'embedding failed');
    }
  }

  /**
   * Embeds everything not yet embedded, a batch at a time, until nothing is
   * pending. Safe to call on boot; runs in the background, never blocks.
   */
  async backfill(): Promise<void> {
    if (this.working) return;
    this.working = true;
    try {
      for (;;) {
        const before = this.deps.embeddings.pendingCount();
        if (before === 0) return;
        await this.index(this.deps.embeddings.pending(BACKFILL_BATCH));
        // Stop if a batch made no progress -- the embedder is down, and looping
        // would spin forever on the same rows.
        if (this.deps.embeddings.pendingCount() >= before) return;
      }
    } finally {
      this.working = false;
    }
  }
}
