import type { Folder } from '../../domain/artifacts/folder.js';
import type { FolderRepo } from '../../application/ports/folder-repo.js';
import { entityId } from '../../domain/ids.js';
import type { Db } from './types.js';

interface FolderRow {
  id: string;
  name: string;
  parent_id: string | null;
  created_at: string;
  deleted_at: string | null;
}

function isPrimaryKeyCollision(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error as { code?: string }).code === 'SQLITE_CONSTRAINT_PRIMARYKEY'
  );
}

/** The trash is invisible to every ordinary query -- see the artifact repo. */
const LIVE = 'deleted_at IS NULL';

/** SQLite adapter for {@link FolderRepo}. */
export class SqliteFolderRepo implements FolderRepo {
  constructor(private readonly db: Db) {}

  insert(folder: Folder): Folder {
    const insert = this.db.prepare(
      'INSERT INTO folders (id, name, parent_id, created_at) VALUES (?, ?, ?, ?)',
    );
    let current = folder;
    for (let attempt = 0; ; attempt += 1) {
      try {
        insert.run(
          current.id,
          current.name,
          current.parentId === '' ? null : current.parentId,
          current.createdAt,
        );
        return current;
      } catch (error) {
        if (attempt >= 1 || !isPrimaryKeyCollision(error)) throw error;
        current = { ...current, id: entityId('folder') };
      }
    }
  }

  get(id: string): Folder | undefined {
    const row = this.db.prepare(`SELECT * FROM folders WHERE id = ? AND ${LIVE}`).get(id) as
      | FolderRow
      | undefined;
    return row === undefined ? undefined : toFolder(row);
  }

  list(): Folder[] {
    const rows = this.db.prepare(`SELECT * FROM folders WHERE ${LIVE} ORDER BY name`).all() as FolderRow[];
    return rows.map(toFolder);
  }

  rename(id: string, name: string): boolean {
    return this.db.prepare('UPDATE folders SET name = ? WHERE id = ?').run(name, id).changes > 0;
  }

  delete(id: string): boolean {
    return this.db.prepare('DELETE FROM folders WHERE id = ?').run(id).changes > 0;
  }

  trash(id: string, at: string): boolean {
    return (
      this.db.prepare(`UPDATE folders SET deleted_at = ? WHERE id = ? AND ${LIVE}`).run(at, id)
        .changes > 0
    );
  }

  restore(id: string): boolean {
    return (
      this.db
        .prepare('UPDATE folders SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL')
        .run(id).changes > 0
    );
  }

  listTrashed(): Folder[] {
    const rows = this.db
      .prepare('SELECT * FROM folders WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC')
      .all() as FolderRow[];
    return rows.map(toFolder);
  }

  getTrashed(id: string): Folder | undefined {
    const row = this.db
      .prepare('SELECT * FROM folders WHERE id = ? AND deleted_at IS NOT NULL')
      .get(id) as FolderRow | undefined;
    return row === undefined ? undefined : toFolder(row);
  }

  listTrashedBefore(cutoff: string): Folder[] {
    const rows = this.db
      .prepare('SELECT * FROM folders WHERE deleted_at IS NOT NULL AND deleted_at < ?')
      .all(cutoff) as FolderRow[];
    return rows.map(toFolder);
  }
}

function toFolder(row: FolderRow): Folder {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parent_id ?? '',
    createdAt: row.created_at,
    ...(row.deleted_at === null ? {} : { deletedAt: row.deleted_at }),
  };
}
