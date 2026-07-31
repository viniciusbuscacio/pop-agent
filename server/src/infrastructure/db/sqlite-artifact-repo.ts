import type { Artifact, ArtifactSource } from '../../domain/artifacts/artifact.js';
import type { ArtifactRepo } from '../../application/ports/artifact-repo.js';
import { entityId } from '../../domain/ids.js';
import type { Db } from './types.js';

/**
 * A primary-key collision is astronomically unlikely with 65-bit ids, but the
 * behaviour is defined (popy.spec §6): re-draw the id and try once more rather
 * than fail the request or overwrite. One retry is plenty.
 */
function isPrimaryKeyCollision(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error as { code?: string }).code === 'SQLITE_CONSTRAINT_PRIMARYKEY'
  );
}

interface ArtifactRow {
  id: string;
  chat_id: string;
  name: string;
  mime: string;
  size: number;
  version: number;
  source: string;
  created_at: string;
  updated_at: string;
}

/** SQLite adapter for {@link ArtifactRepo}. */
export class SqliteArtifactRepo implements ArtifactRepo {
  constructor(private readonly db: Db) {}

  insert(artifact: Artifact): Artifact {
    const insert = this.db.prepare(
      `INSERT INTO artifacts
         (id, chat_id, name, mime, size, version, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    let current = artifact;
    for (let attempt = 0; ; attempt += 1) {
      try {
        insert.run(
          current.id,
          current.chatId,
          current.name,
          current.mime,
          current.size,
          current.version,
          current.source,
          current.createdAt,
          current.updatedAt,
        );
        return current;
      } catch (error) {
        if (attempt >= 1 || !isPrimaryKeyCollision(error)) throw error;
        current = { ...current, id: entityId('file') };
      }
    }
  }

  get(id: string): Artifact | undefined {
    const row = this.db.prepare('SELECT * FROM artifacts WHERE id = ?').get(id) as
      | ArtifactRow
      | undefined;
    return row === undefined ? undefined : toArtifact(row);
  }

  listByChat(chatId: string): Artifact[] {
    const rows = this.db
      .prepare('SELECT * FROM artifacts WHERE chat_id = ? ORDER BY created_at, rowid')
      .all(chatId) as ArtifactRow[];
    return rows.map(toArtifact);
  }

  delete(id: string): boolean {
    return this.db.prepare('DELETE FROM artifacts WHERE id = ?').run(id).changes > 0;
  }
}

function toArtifact(row: ArtifactRow): Artifact {
  return {
    id: row.id,
    chatId: row.chat_id,
    name: row.name,
    mime: row.mime,
    size: row.size,
    version: row.version,
    source: row.source as ArtifactSource,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
