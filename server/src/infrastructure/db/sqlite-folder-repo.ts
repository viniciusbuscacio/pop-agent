import type { Folder } from '../../domain/artifacts/folder.js';
import type { FolderRepo } from '../../application/ports/folder-repo.js';
import { entityId } from '../../domain/ids.js';
import type { Db } from './types.js';

interface FolderRow {
  id: string;
  name: string;
  created_at: string;
}

function isPrimaryKeyCollision(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error as { code?: string }).code === 'SQLITE_CONSTRAINT_PRIMARYKEY'
  );
}

/** SQLite adapter for {@link FolderRepo}. */
export class SqliteFolderRepo implements FolderRepo {
  constructor(private readonly db: Db) {}

  insert(folder: Folder): Folder {
    const insert = this.db.prepare(
      'INSERT INTO folders (id, name, created_at) VALUES (?, ?, ?)',
    );
    let current = folder;
    for (let attempt = 0; ; attempt += 1) {
      try {
        insert.run(current.id, current.name, current.createdAt);
        return current;
      } catch (error) {
        if (attempt >= 1 || !isPrimaryKeyCollision(error)) throw error;
        current = { ...current, id: entityId('folder') };
      }
    }
  }

  get(id: string): Folder | undefined {
    const row = this.db.prepare('SELECT * FROM folders WHERE id = ?').get(id) as
      | FolderRow
      | undefined;
    return row === undefined ? undefined : toFolder(row);
  }

  list(): Folder[] {
    const rows = this.db.prepare('SELECT * FROM folders ORDER BY name').all() as FolderRow[];
    return rows.map(toFolder);
  }

  rename(id: string, name: string): boolean {
    return this.db.prepare('UPDATE folders SET name = ? WHERE id = ?').run(name, id).changes > 0;
  }

  delete(id: string): boolean {
    return this.db.prepare('DELETE FROM folders WHERE id = ?').run(id).changes > 0;
  }
}

function toFolder(row: FolderRow): Folder {
  return { id: row.id, name: row.name, createdAt: row.created_at };
}
