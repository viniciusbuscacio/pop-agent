import { open, seal } from '../../application/crypto/secret-box.js';
import type { SecretsRepo } from '../../application/ports/secrets-repo.js';
import type { Db } from './types.js';

/**
 * SQLite adapter for {@link SecretsRepo}. Plaintext exists only in memory and
 * in the caller's hands: what reaches the table is always sealed.
 */
export class SqliteSecretsRepo implements SecretsRepo {
  constructor(
    private readonly db: Db,
    private readonly key: Buffer,
  ) {}

  get(key: string): string | undefined {
    const row = this.db.prepare('SELECT value_encrypted FROM secrets WHERE key = ?').get(key) as
      | { value_encrypted: Buffer }
      | undefined;
    return row === undefined ? undefined : open(this.key, row.value_encrypted);
  }

  set(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO secrets (key, value_encrypted) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value_encrypted = excluded.value_encrypted`,
      )
      .run(key, seal(this.key, value));
  }

  delete(key: string): void {
    this.db.prepare('DELETE FROM secrets WHERE key = ?').run(key);
  }
}
