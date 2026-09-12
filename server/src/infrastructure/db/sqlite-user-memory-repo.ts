import type { UserMemory, UserMemoryRepo } from '../../application/ports/user-memory-repo.js';
import type { Db } from './types.js';

/** SQLite adapter for {@link UserMemoryRepo}: the one-row living document. */
export class SqliteUserMemoryRepo implements UserMemoryRepo {
  onChanged?: () => void;
  constructor(private readonly db: Db) {}

  read(): UserMemory {
    const row = this.db
      .prepare('SELECT doc, backup, last_condensed_at FROM user_memory WHERE id = 1')
      .get() as { doc: string; backup: string; last_condensed_at: string } | undefined;
    return {
      doc: row?.doc ?? '',
      backup: row?.backup ?? '',
      lastCondensedAt: row?.last_condensed_at ?? '',
    };
  }

  write(doc: string): void {
    // The old doc becomes the backup, so one bad edit is always reversible.
    this.db
      .prepare('UPDATE user_memory SET backup = doc, doc = ? WHERE id = 1')
      .run(doc);
    this.onChanged?.();
  }

  restoreBackup(): void {
    const current = this.read();
    this.db
      .prepare('UPDATE user_memory SET doc = ?, backup = ? WHERE id = 1')
      .run(current.backup, current.doc);
    this.onChanged?.();
  }

  markCondensed(at: string): void {
    this.db.prepare('UPDATE user_memory SET last_condensed_at = ? WHERE id = 1').run(at);
  }
}
