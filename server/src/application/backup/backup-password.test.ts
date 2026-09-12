import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { SqliteSecretsRepo } from '../../infrastructure/db/sqlite-secrets-repo.js';
import { BACKUP_PASSWORD_KEY, BackupPassword } from './backup-password.js';

describe('backup password storage', () => {
  it('persists only encrypted bytes and retrieves the password through the host key', () => {
    const db = new Database(':memory:');
    try {
      db.exec('CREATE TABLE secrets (key TEXT PRIMARY KEY, value_encrypted BLOB NOT NULL)');
      const key = randomBytes(32);
      const password = 'a separate backup password';
      const service = new BackupPassword(new SqliteSecretsRepo(db, key));
      expect(service.configured()).toBe(false);
      expect(() => service.read()).toThrow('Set a backup password');
      expect(() => service.save('short')).toThrow();
      service.save(password);
      const raw = db.prepare('SELECT value_encrypted FROM secrets WHERE key = ?').pluck().get(BACKUP_PASSWORD_KEY) as Buffer;
      expect(raw.includes(Buffer.from(password))).toBe(false);
      expect(new BackupPassword(new SqliteSecretsRepo(db, key)).read()).toBe(password);
      expect(() => new BackupPassword(new SqliteSecretsRepo(db, randomBytes(32))).read()).toThrow();
    } finally { db.close(); }
  });
});
