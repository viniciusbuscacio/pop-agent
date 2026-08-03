import type { Artifact, ArtifactSource } from '../../domain/artifacts/artifact.js';
import type { ArtifactRepo, ArtifactVersion } from '../../application/ports/artifact-repo.js';
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
  chat_id: string | null;
  folder_id: string | null;
  name: string;
  mime: string;
  size: number;
  version: number;
  source: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/**
 * The trash is invisible to every ordinary query (popy.spec §14). The filter
 * is one constant used by all of them rather than a condition each query
 * repeats: a listing that forgot it would quietly resurrect deleted files, and
 * that is not the kind of mistake a reviewer catches by eye.
 */
const LIVE = 'deleted_at IS NULL';

/** SQLite adapter for {@link ArtifactRepo}. */
export class SqliteArtifactRepo implements ArtifactRepo {
  constructor(private readonly db: Db) {}

  insert(artifact: Artifact): Artifact {
    const insert = this.db.prepare(
      `INSERT INTO artifacts
         (id, chat_id, folder_id, name, mime, size, version, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    let current = artifact;
    for (let attempt = 0; ; attempt += 1) {
      try {
        insert.run(
          current.id,
          current.chatId === '' ? null : current.chatId,
          current.folderId === '' ? null : current.folderId,
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
    const row = this.db.prepare(`SELECT * FROM artifacts WHERE id = ? AND ${LIVE}`).get(id) as
      | ArtifactRow
      | undefined;
    return row === undefined ? undefined : toArtifact(row);
  }

  listByChat(chatId: string): Artifact[] {
    const rows = this.db
      .prepare(`SELECT * FROM artifacts WHERE chat_id = ? AND ${LIVE} ORDER BY created_at, rowid`)
      .all(chatId) as ArtifactRow[];
    return rows.map(toArtifact);
  }

  listAll(): Artifact[] {
    const rows = this.db
      .prepare(`SELECT * FROM artifacts WHERE ${LIVE} ORDER BY created_at DESC, rowid DESC`)
      .all() as ArtifactRow[];
    return rows.map(toArtifact);
  }

  listByFolder(folderId: string): Artifact[] {
    const rows = (
      folderId === ''
        ? this.db
            .prepare(`SELECT * FROM artifacts WHERE folder_id IS NULL AND ${LIVE} ORDER BY created_at DESC, rowid DESC`)
            .all()
        : this.db
            .prepare(`SELECT * FROM artifacts WHERE folder_id = ? AND ${LIVE} ORDER BY created_at DESC, rowid DESC`)
            .all(folderId)
    ) as ArtifactRow[];
    return rows.map(toArtifact);
  }

  rename(id: string, name: string, at: string): boolean {
    return (
      this.db
        .prepare('UPDATE artifacts SET name = ?, updated_at = ? WHERE id = ?')
        .run(name, at, id).changes > 0
    );
  }

  setFolder(id: string, folderId: string, at: string): boolean {
    return (
      this.db
        .prepare('UPDATE artifacts SET folder_id = ?, updated_at = ? WHERE id = ?')
        .run(folderId === '' ? null : folderId, at, id).changes > 0
    );
  }

  delete(id: string): boolean {
    return this.db.prepare('DELETE FROM artifacts WHERE id = ?').run(id).changes > 0;
  }

  trash(id: string, at: string): boolean {
    return (
      this.db
        .prepare(`UPDATE artifacts SET deleted_at = ? WHERE id = ? AND ${LIVE}`)
        .run(at, id).changes > 0
    );
  }

  restore(id: string): boolean {
    return (
      this.db
        .prepare('UPDATE artifacts SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL')
        .run(id).changes > 0
    );
  }

  listTrashed(): Artifact[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM artifacts WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC, rowid DESC',
      )
      .all() as ArtifactRow[];
    return rows.map(toArtifact);
  }

  getTrashed(id: string): Artifact | undefined {
    const row = this.db
      .prepare('SELECT * FROM artifacts WHERE id = ? AND deleted_at IS NOT NULL')
      .get(id) as ArtifactRow | undefined;
    return row === undefined ? undefined : toArtifact(row);
  }

  listTrashedBefore(cutoff: string): Artifact[] {
    // Strictly older than the cutoff: ISO strings compare lexicographically,
    // which is exactly chronological for the same-length UTC form used here.
    const rows = this.db
      .prepare('SELECT * FROM artifacts WHERE deleted_at IS NOT NULL AND deleted_at < ?')
      .all(cutoff) as ArtifactRow[];
    return rows.map(toArtifact);
  }

  addVersion(id: string, version: ArtifactVersion): void {
    this.db
      .prepare(
        `INSERT INTO artifact_versions (artifact_id, version, mime, size, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, version.version, version.mime, version.size, version.source, version.createdAt);
  }

  listVersions(id: string): ArtifactVersion[] {
    const rows = this.db
      .prepare(
        `SELECT version, mime, size, source, created_at
           FROM artifact_versions
          WHERE artifact_id = ?
       ORDER BY version DESC`,
      )
      .all(id) as { version: number; mime: string; size: number; source: string; created_at: string }[];
    return rows.map((row) => ({
      version: row.version,
      mime: row.mime,
      size: row.size,
      source: row.source as ArtifactSource,
      createdAt: row.created_at,
    }));
  }

  updateLatest(
    id: string,
    next: { mime: string; size: number; version: number; updatedAt: string },
  ): void {
    this.db
      .prepare('UPDATE artifacts SET mime = ?, size = ?, version = ?, updated_at = ? WHERE id = ?')
      .run(next.mime, next.size, next.version, next.updatedAt, id);
  }
}

function toArtifact(row: ArtifactRow): Artifact {
  return {
    id: row.id,
    chatId: row.chat_id ?? '',
    folderId: row.folder_id ?? '',
    name: row.name,
    mime: row.mime,
    size: row.size,
    version: row.version,
    source: row.source as ArtifactSource,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.deleted_at === null ? {} : { deletedAt: row.deleted_at }),
  };
}
