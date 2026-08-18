import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TarBackupService } from './tar-backup-service.js';

let root: string;
let dataDir: string;
let backupsDir: string;
let service: TarBackupService;
let clock = 1_700_000_000_000;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pop-backup-test-'));
  dataDir = join(root, 'data');
  backupsDir = join(root, 'backups');
  mkdirSync(dataDir, { recursive: true });
  const database = new Database(join(dataDir, 'pop-agent.db'));
  database.exec('CREATE TABLE facts (value TEXT); INSERT INTO facts VALUES (\'the database\')');
  database.close();
  writeFileSync(join(dataDir, 'secret.key'), 'TOP SECRET');
  clock = 1_700_000_000_000;
  service = new TarBackupService({
    dataDir,
    backupsDir,
    now: () => new Date((clock += 1000)).toISOString(),
  });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('TarBackupService', () => {
  it('creates a backup and lists it', async () => {
    const info = await service.create();
    expect(info.name).toMatch(/^pop-backup-.*\.tar\.gz$/);
    expect(info.size).toBeGreaterThan(0);
    expect(service.list().map((b) => b.name)).toContain(info.name);
  });

  it('excludes the secret key from the archive', async () => {
    const info = await service.create();
    // Extract into a fresh dir and confirm the key is not there.
    const out = join(root, 'out');
    mkdirSync(out);
    const path = service.pathOf(info.name);
    expect(path).toBeDefined();
    execFileSync('tar', ['-xzf', path as string, '-C', out]);
    expect(existsSync(join(out, 'pop-agent.db'))).toBe(true);
    expect(existsSync(join(out, 'secret.key'))).toBe(false);
  });

  it('restores data over the data directory', async () => {
    const info = await service.create();
    const changed = new Database(join(dataDir, 'pop-agent.db'));
    changed.prepare('UPDATE facts SET value = ?').run('changed after backup');
    changed.close();

    expect(service.restore(info.name)).toBe(true);
    const restored = new Database(join(dataDir, 'pop-agent.db'), { readonly: true });
    expect(restored.prepare('SELECT value FROM facts').pluck().get()).toBe('the database');
    restored.close();
    // The secret key, never in the backup, is left untouched.
    expect(readFileSync(join(dataDir, 'secret.key'), 'utf8')).toBe('TOP SECRET');
  });

  it('captures committed WAL content through a consistent SQLite snapshot', async () => {
    const live = new Database(join(dataDir, 'pop-agent.db'));
    live.pragma('journal_mode = WAL');
    live.pragma('wal_autocheckpoint = 0');
    live.prepare('INSERT INTO facts VALUES (?)').run('committed in wal');

    const info = await service.create();
    live.close();
    const out = join(root, 'wal-out');
    mkdirSync(out);
    execFileSync('tar', ['-xzf', service.pathOf(info.name) as string, '-C', out]);
    expect(existsSync(join(out, 'pop-agent.db-wal'))).toBe(false);
    expect(existsSync(join(out, 'pop-agent.db-shm'))).toBe(false);
    const snapshot = new Database(join(out, 'pop-agent.db'), { readonly: true });
    expect(snapshot.prepare('SELECT value FROM facts ORDER BY rowid').pluck().all()).toEqual([
      'the database',
      'committed in wal',
    ]);
    snapshot.close();
  });

  it('refuses a name with a path traversal', () => {
    expect(service.pathOf('../etc/passwd')).toBeUndefined();
    expect(service.restore('pop-backup-../x.tar.gz')).toBe(false);
  });

  it('deletes a backup', async () => {
    const info = await service.create();
    expect(service.delete(info.name)).toBe(true);
    expect(service.list()).toHaveLength(0);
  });
});
