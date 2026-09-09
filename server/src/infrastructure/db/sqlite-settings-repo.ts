import type { SettingsRepo } from '../../application/ports/settings-repo.js';
import type { Db } from './types.js';

/** SQLite adapter for {@link SettingsRepo}: one JSON document per key. */
export class SqliteSettingsRepo implements SettingsRepo {
  onChanged?: (key: string) => void;
  constructor(private readonly db: Db) {}

  get<T>(key: string): T | undefined {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row === undefined ? undefined : (JSON.parse(row.value) as T);
  }

  set<T>(key: string, value: T): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, JSON.stringify(value));
    this.onChanged?.(key);
  }
}
