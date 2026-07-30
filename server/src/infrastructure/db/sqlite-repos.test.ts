import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { SECRET_KEY_BYTES } from '../../application/crypto/secret-box.js';
import { migrate } from './migrate.js';
import { SqliteSecretsRepo } from './sqlite-secrets-repo.js';
import { SqliteSettingsRepo } from './sqlite-settings-repo.js';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  migrate(db);
});

describe('sqlite settings repo', () => {
  it('round-trips a JSON document', () => {
    const repo = new SqliteSettingsRepo(db);
    repo.set('general', { language: 'en', updates: { autoCheck: false } });

    expect(repo.get('general')).toEqual({ language: 'en', updates: { autoCheck: false } });
  });

  it('returns undefined for a key that was never written', () => {
    expect(new SqliteSettingsRepo(db).get('missing')).toBeUndefined();
  });

  it('overwrites instead of duplicating', () => {
    const repo = new SqliteSettingsRepo(db);
    repo.set('epoch', 1);
    repo.set('epoch', 2);

    expect(repo.get('epoch')).toBe(2);
    const rows = db.prepare('SELECT count(*) AS n FROM settings').get() as { n: number };
    expect(rows.n).toBe(1);
  });
});

describe('sqlite secrets repo', () => {
  const key = randomBytes(SECRET_KEY_BYTES);

  it('round-trips a secret', () => {
    const repo = new SqliteSecretsRepo(db, key);
    repo.set('openrouter.apiKey', 'sk-or-v1-secret');

    expect(repo.get('openrouter.apiKey')).toBe('sk-or-v1-secret');
  });

  it('stores no plaintext on disk', () => {
    const repo = new SqliteSecretsRepo(db, key);
    repo.set('openrouter.apiKey', 'sk-or-v1-secret');

    const row = db.prepare('SELECT value_encrypted FROM secrets WHERE key = ?').get(
      'openrouter.apiKey',
    ) as { value_encrypted: Buffer };
    expect(row.value_encrypted.includes('sk-or-v1-secret')).toBe(false);
  });

  it('cannot be read with a different key', () => {
    new SqliteSecretsRepo(db, key).set('openrouter.apiKey', 'sk-or-v1-secret');
    const impostor = new SqliteSecretsRepo(db, randomBytes(SECRET_KEY_BYTES));

    expect(() => impostor.get('openrouter.apiKey')).toThrow();
  });

  it('deletes', () => {
    const repo = new SqliteSecretsRepo(db, key);
    repo.set('gone', 'value');
    repo.delete('gone');

    expect(repo.get('gone')).toBeUndefined();
  });

  it('returns undefined for a key that was never written', () => {
    expect(new SqliteSecretsRepo(db, key).get('missing')).toBeUndefined();
  });
});
