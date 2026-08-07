import type {
  SkillVectorsRepo,
  StoredSkillVector,
} from '../../application/ports/skill-vectors-repo.js';
import type { Db } from './types.js';

/** SQLite adapter for {@link SkillVectorsRepo}. Vectors are Float32Array BLOBs. */
export class SqliteSkillVectorsRepo implements SkillVectorsRepo {
  constructor(private readonly db: Db) {}

  all(): StoredSkillVector[] {
    const rows = this.db
      .prepare('SELECT slug, signature, vector FROM skill_embeddings')
      .all() as { slug: string; signature: string; vector: Buffer }[];
    return rows.map((row) => ({
      slug: row.slug,
      signature: row.signature,
      vector: toFloat32(row.vector),
    }));
  }

  save(slug: string, signature: string, vector: Float32Array): void {
    this.db
      .prepare(
        `INSERT INTO skill_embeddings (slug, signature, vector) VALUES (?, ?, ?)
         ON CONFLICT(slug) DO UPDATE SET signature = excluded.signature, vector = excluded.vector`,
      )
      .run(slug, signature, Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength));
  }

  keepOnly(slugs: readonly string[]): void {
    if (slugs.length === 0) {
      this.db.prepare('DELETE FROM skill_embeddings').run();
      return;
    }
    const holes = slugs.map(() => '?').join(', ');
    this.db.prepare(`DELETE FROM skill_embeddings WHERE slug NOT IN (${holes})`).run(...slugs);
  }
}

/** A BLOB back into a Float32Array, copying so it does not alias the buffer. */
function toFloat32(buffer: Buffer): Float32Array {
  const copy = new Uint8Array(buffer.byteLength);
  copy.set(buffer);
  return new Float32Array(copy.buffer);
}
