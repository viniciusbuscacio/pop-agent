import type {
  ArtifactChunk,
  ArtifactChunksRepo,
} from '../../application/ports/artifact-chunks-repo.js';
import type { Db } from './types.js';

interface ChunkRow {
  artifact_id: string;
  chunk: number;
  text: string;
  vector: Buffer;
}

/** SQLite adapter for {@link ArtifactChunksRepo}. */
export class SqliteArtifactChunksRepo implements ArtifactChunksRepo {
  constructor(private readonly db: Db) {}

  replaceFor(artifactId: string, chunks: { text: string; vector: Float32Array }[]): void {
    const wipe = this.db.prepare('DELETE FROM artifact_chunks WHERE artifact_id = ?');
    const insert = this.db.prepare(
      'INSERT INTO artifact_chunks (artifact_id, chunk, text, vector) VALUES (?, ?, ?, ?)',
    );
    const apply = this.db.transaction(() => {
      wipe.run(artifactId);
      chunks.forEach((entry, index) => {
        insert.run(artifactId, index, entry.text, Buffer.from(entry.vector.buffer));
      });
    });
    apply();
  }

  all(): ArtifactChunk[] {
    const rows = this.db.prepare('SELECT * FROM artifact_chunks').all() as ChunkRow[];
    return rows.map((row) => ({
      artifactId: row.artifact_id,
      chunk: row.chunk,
      text: row.text,
      vector: new Float32Array(
        row.vector.buffer,
        row.vector.byteOffset,
        row.vector.byteLength / 4,
      ),
    }));
  }

  indexedArtifactIds(): Set<string> {
    const rows = this.db
      .prepare('SELECT DISTINCT artifact_id FROM artifact_chunks')
      .all() as { artifact_id: string }[];
    return new Set(rows.map((row) => row.artifact_id));
  }
}
