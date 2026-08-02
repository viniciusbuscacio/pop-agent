import type { PathIndexEntry, PathIndexRepo } from '../../application/ports/path-index-repo.js';
import type { Db } from './types.js';

interface PathIndexRow {
  kind: string;
  ref_id: string;
  name: string;
  path: string;
  parent_id: string | null;
}

/** Escapes the LIKE metacharacters so a literal `%` or `_` in the query does
 * not turn into a wildcard. Paired with `ESCAPE '\'` in the statement. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

/** SQLite adapter for {@link PathIndexRepo}. */
export class SqlitePathIndexRepo implements PathIndexRepo {
  constructor(private readonly db: Db) {}

  replaceAll(entries: readonly PathIndexEntry[]): void {
    const clear = this.db.prepare('DELETE FROM path_index');
    const insert = this.db.prepare(
      'INSERT INTO path_index (kind, ref_id, name, path, parent_id) VALUES (?, ?, ?, ?, ?)',
    );
    const write = this.db.transaction((rows: readonly PathIndexEntry[]) => {
      clear.run();
      for (const entry of rows) {
        insert.run(entry.kind, entry.refId, entry.name, entry.path, entry.parentId === '' ? null : entry.parentId);
      }
    });
    write(entries);
  }

  search(query: string, limit: number): PathIndexEntry[] {
    const like = `%${escapeLike(query.toLowerCase())}%`;
    const rows = this.db
      .prepare(
        `SELECT kind, ref_id, name, path, parent_id
           FROM path_index
          WHERE lower(name) LIKE ? ESCAPE '\\' OR lower(path) LIKE ? ESCAPE '\\'
       ORDER BY kind DESC, path
          LIMIT ?`,
      )
      .all(like, like, limit) as PathIndexRow[];
    return rows.map(toEntry);
  }
}

function toEntry(row: PathIndexRow): PathIndexEntry {
  return {
    kind: row.kind === 'folder' ? 'folder' : 'file',
    refId: row.ref_id,
    name: row.name,
    path: row.path,
    parentId: row.parent_id ?? '',
  };
}
