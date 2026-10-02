import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { SqliteSecretsRepo } from '../db/sqlite-secrets-repo.js';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decryptArchive } from './archive-crypto.js';
import { TarBackupService } from './tar-backup-service.js';

let root: string;
let dataDir: string;
let backupsDir: string;
let service: TarBackupService;
const password = 'backup-test-password';
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
    secrets: { get: () => password, set: () => {}, delete: () => {} },
    now: () => new Date((clock += 1000)).toISOString(),
  });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('TarBackupService', () => {
  it('restores on a new host without the original host key and resaves the backup password', async () => {
    const db = new Database(join(dataDir, 'pop-agent.db'));
    db.exec('CREATE TABLE secrets (key TEXT PRIMARY KEY, value_encrypted BLOB NOT NULL)');
    new SqliteSecretsRepo(db, randomBytes(32)).set('provider.test.apiKey', 'old-provider-secret');
    db.close();
    const info = await service.create();
    const fresh = join(root, 'fresh-host');
    mkdirSync(fresh);
    const target = new TarBackupService({ dataDir: fresh, backupsDir, now: () => new Date().toISOString() });
    expect(await target.restore(info.name, password)).toBe(true);
    const restored = new Database(join(fresh, 'pop-agent.db'));
    try {
      const secrets = new SqliteSecretsRepo(restored, readFileSync(join(fresh, 'secret.key')));
      expect(secrets.get('provider.test.apiKey')).toBeUndefined();
      expect(secrets.get('session_hmac_secret')).toBeDefined();
      expect(secrets.get('backup.archive-password')).toBe(password);
      expect(restored.prepare('SELECT value FROM facts').pluck().get()).toBe('the database');
    } finally { restored.close(); }
  });

  it('never creates a plaintext fallback when a password is missing', async () => {
    const unconfigured = new TarBackupService({ dataDir, backupsDir, now: () => new Date().toISOString() });
    await expect(unconfigured.create()).rejects.toThrow('Set a backup password');
    expect(unconfigured.list()).toEqual([]);
  });

  it('rejects wrong passwords and damaged archives without touching data', async () => {
    const info = await service.create();
    const path = service.pathOf(info.name) as string;
    const before = readFileSync(join(dataDir, 'pop-agent.db'));
    await expect(service.restore(info.name, 'wrong-backup-password')).rejects.toThrow('Check its password');
    expect(readFileSync(join(dataDir, 'pop-agent.db'))).toEqual(before);
    const bytes = readFileSync(path);
    expect(bytes.subarray(0, 8).toString()).toBe('POPBAK01');
    expect(bytes.includes(Buffer.from(password))).toBe(false);
    const last = bytes.length - 1;
    bytes[last] = (bytes[last] ?? 0) ^ 1;
    writeFileSync(path, bytes);
    await expect(service.restore(info.name, password)).rejects.toThrow('Check its password');
    expect(readFileSync(join(dataDir, 'pop-agent.db'))).toEqual(before);
  });

  it('uses different salts/nonces for the same password and keeps old passwords valid after rotation', async () => {
    let saved = password;
    const reusable = new TarBackupService({ dataDir, backupsDir, now: () => new Date().toISOString(),
      secrets: { get: () => saved, set: (_key, value) => { saved = value; }, delete: () => {} } });
    const first = await reusable.create();
    const second = await reusable.create();
    const header = (name: string) => readFileSync(reusable.pathOf(name) as string).subarray(8, 36);
    expect(header(first.name)).not.toEqual(header(second.name));
    reusable.setPassword('replacement-backup-password');
    const third = await reusable.create();
    await expect(reusable.restore(first.name, 'replacement-backup-password')).rejects.toThrow();
    expect(await reusable.restore(first.name, password)).toBe(true);
    expect(await reusable.restore(third.name, 'replacement-backup-password')).toBe(true);
  });

  it('restores legacy archives and labels them as unencrypted', async () => {
    const name = 'pop-backup-legacy.tar.gz';
    execFileSync('tar', ['-czf', join(backupsDir, name), '-C', dataDir, 'pop-agent.db']);
    expect(service.list().find((entry) => entry.name === name)?.encrypted).toBe(false);
    expect(await service.restore(name)).toBe(true);
  });

  it('refuses archives containing the excluded host key', async () => {
    const name = 'pop-backup-unsafe.tar.gz';
    execFileSync('tar', ['-czf', join(backupsDir, name), '-C', dataDir, '.']);
    await expect(service.restore(name)).rejects.toThrow('unsafe');
    expect(readFileSync(join(dataDir, 'secret.key'), 'utf8')).toBe('TOP SECRET');
  });

  it('does not overwrite an external file through a pre-existing destination symlink', async () => {
    writeFileSync(join(dataDir, 'example.txt'), 'backed up text');
    const info = await service.create();
    const outside = join(root, 'outside.txt');
    writeFileSync(outside, 'must remain unchanged');
    rmSync(join(dataDir, 'example.txt'));
    symlinkSync(outside, join(dataDir, 'example.txt'));
    await service.restore(info.name, password).catch(() => false);
    expect(readFileSync(outside, 'utf8')).toBe('must remain unchanged');
  });

  it('refuses an archive with an escaping symlink', async () => {
    symlinkSync('../../outside', join(dataDir, 'unsafe-link'));
    const name = 'pop-backup-link.tar.gz';
    execFileSync('tar', ['-czf', join(backupsDir, name), '-C', dataDir, 'pop-agent.db', 'unsafe-link']);
    await expect(service.restore(name)).rejects.toThrow('unsafe');
  });

  it('creates a backup and lists it', async () => {
    const info = await service.create();
    expect(info.name).toMatch(/^pop-backup-.*\.popbackup$/);
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
    const plain = join(root, 'verified.tar.gz');
    await decryptArchive(path as string, plain, password);
    execFileSync('tar', ['-xzf', plain, '-C', out]);
    expect(existsSync(join(out, 'pop-agent.db'))).toBe(true);
    expect(existsSync(join(out, 'secret.key'))).toBe(false);
  });

  it('restores data over the data directory', async () => {
    const info = await service.create();
    const changed = new Database(join(dataDir, 'pop-agent.db'));
    changed.prepare('UPDATE facts SET value = ?').run('changed after backup');
    changed.close();

    expect(await service.restore(info.name, password)).toBe(true);
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
    const plain = join(root, 'wal-verified.tar.gz');
    await decryptArchive(service.pathOf(info.name) as string, plain, password);
    execFileSync('tar', ['-xzf', plain, '-C', out]);
    expect(existsSync(join(out, 'pop-agent.db-wal'))).toBe(false);
    expect(existsSync(join(out, 'pop-agent.db-shm'))).toBe(false);
    const snapshot = new Database(join(out, 'pop-agent.db'), { readonly: true });
    expect(snapshot.prepare('SELECT value FROM facts ORDER BY rowid').pluck().all()).toEqual([
      'the database',
      'committed in wal',
    ]);
    snapshot.close();
  });

  it('refuses a name with a path traversal', async () => {
    expect(service.pathOf('../etc/passwd')).toBeUndefined();
    expect(await service.restore('pop-backup-../x.tar.gz')).toBe(false);
  });

  it('deletes a backup', async () => {
    const info = await service.create();
    expect(service.delete(info.name)).toBe(true);
    expect(service.list()).toHaveLength(0);
  });
});

it('queues encrypted browser restore, exposes progress, rejects overlap and applies only at cold boot', async () => {
  const restart = vi.fn();
  const browser = new TarBackupService({ dataDir, backupsDir, now: () => new Date().toISOString(),
    secrets: { get: () => password, set: () => {}, delete: () => {} }, restartForRestore: restart });
  const creating = browser.create();
  expect(browser.status().state).toBe('creating');
  expect(() => browser.requestRestore('anything')).toThrow('already running');
  const backup = await creating;
  expect(browser.status().state).toBe('idle');
  const original = readFileSync(join(dataDir, 'pop-agent.db'));
  browser.requestRestore(backup.name, 'incorrect-password');
  await vi.waitFor(() => expect(browser.status().state).toBe('failed'));
  expect(restart).not.toHaveBeenCalled();
  expect(readFileSync(join(dataDir, 'pop-agent.db'))).toEqual(original);
  writeFileSync(join(dataDir, 'newer-file'), 'after backup');
  browser.requestRestore(backup.name, password);
  expect(browser.status().state).toBe('preparing');
  expect(() => browser.delete(backup.name)).toThrow('already running');
  expect(() => browser.setPassword('other-password')).toThrow('already running');
  await vi.waitFor(() => expect(restart).toHaveBeenCalledOnce());
  expect(browser.status().state).toBe('restarting');
  expect(existsSync(join(dataDir, 'newer-file'))).toBe(true);
  const { applyPendingRestore } = await import('./browser-restore.js');
  await applyPendingRestore(dataDir);
  expect(existsSync(join(dataDir, 'newer-file'))).toBe(false);
  const restored = new Database(join(dataDir, 'pop-agent.db'), { readonly: true });
  expect(restored.prepare('SELECT value FROM facts').pluck().get()).toBe('the database');
  restored.close();
});

it('excludes downloadable model caches while retaining user files and conversation sessions', async () => {
  for (const name of ['models', 'voice-models', 'files', 'sessions']) {
    mkdirSync(join(dataDir, name));
    writeFileSync(join(dataDir, name, 'example'), name);
  }
  const backup = await service.create();
  const archive = join(root, 'verified.tar.gz');
  await decryptArchive(service.pathOf(backup.name) as string, archive, password);
  const names = execFileSync('tar', ['tzf', archive], { encoding: 'utf8' });
  expect(names).not.toContain('./models/');
  expect(names).not.toContain('./voice-models/');
  expect(names).toContain('./files/example');
  expect(names).toContain('./sessions/example');
});

it('can omit Files without omitting chats, and preserves current Files when browser-restoring that archive', async () => {
  mkdirSync(join(dataDir, 'files'));
  writeFileSync(join(dataDir, 'files', 'user-file'), 'keep this current content');
  const backup = await service.create({ includeFiles: false });
  expect(backup.includeFiles).toBe(false);
  expect(service.list()[0]?.includeFiles).toBe(false);
  const archive = join(root, 'without-files.tar.gz');
  await decryptArchive(service.pathOf(backup.name) as string, archive, password);
  const entries = execFileSync('tar', ['tzf', archive], { encoding: 'utf8' });
  expect(entries).not.toContain('./files/');
  expect(entries).toContain('./pop-agent.db');
  const restart = vi.fn();
  const browser = new TarBackupService({ dataDir, backupsDir, now: () => new Date().toISOString(), restartForRestore: restart });
  browser.requestRestore(backup.name, password);
  await vi.waitFor(() => expect(restart).toHaveBeenCalledOnce());
  const { applyPendingRestore } = await import('./browser-restore.js');
  await applyPendingRestore(dataDir);
  expect(readFileSync(join(dataDir, 'files', 'user-file'), 'utf8')).toBe('keep this current content');
});

it('exposes failed creation after navigation instead of reporting an idle success', async () => {
  rmSync(join(dataDir, 'pop-agent.db'));
  await expect(service.create()).rejects.toThrow();
  expect(service.status().state).toBe('failed');
  expect(service.list()).toEqual([]);
});

it('normalizes internal absolute links and restores their included target on a different host', async () => {
  mkdirSync(join(dataDir, 'files'));
  writeFileSync(join(dataDir, 'files', 'target.txt'), 'portable');
  symlinkSync(join(dataDir, 'files', 'target.txt'), join(dataDir, 'files', 'alias'));
  const info = await service.create();
  const destination = join(root, 'destination'); mkdirSync(destination);
  const target = new TarBackupService({ dataDir: destination, backupsDir, now: () => new Date().toISOString() });
  await target.restore(info.name, password);
  expect(readFileSync(join(destination, 'files', 'alias'), 'utf8')).toBe('portable');
});

it('rejects external links at creation without changing the source or publishing an archive', async () => {
  const outside = join(root, 'outside'); writeFileSync(outside, 'outside');
  symlinkSync(outside, join(dataDir, 'external'));
  await expect(service.create()).rejects.toThrow('Cannot back up symbolic link');
  expect(service.list()).toEqual([]);
  expect(service.status().message).toContain('nothing was excluded silently');
  expect(readFileSync(join(dataDir, 'external'), 'utf8')).toBe('outside');
});

it('rejects links to excluded host keys', async () => {
  symlinkSync('secret.key', join(dataDir, 'key-alias'));
  await expect(service.create()).rejects.toThrow('Cannot back up symbolic link');
  expect(service.list()).toEqual([]);
});

it('imports encrypted bytes without password or restore, then roundtrips with explicit password', async () => {
  const original = await service.create();
  const bytes = readFileSync(service.pathOf(original.name)!);
  async function* chunks() { yield bytes.subarray(0, 3); yield bytes.subarray(3); }
  const imported = await service.importArchive(chunks(), new AbortController().signal);
  expect(imported.includeFiles).toBeNull();
  expect(readFileSync(service.pathOf(imported.name)!)).toEqual(bytes);
  expect(service.list()).toHaveLength(2);
  expect(await service.restore(imported.name, password)).toBe(true);
});

it('rejects malformed or truncated imports and removes pending files', async () => {
  const { readdirSync } = await import('node:fs');
  for (const bytes of [Buffer.alloc(100), Buffer.from('POPBAK01')]) {
    async function* chunks() { yield bytes; }
    await expect(service.importArchive(chunks(), new AbortController().signal)).rejects.toThrow();
    expect(readdirSync(backupsDir)).toEqual([]);
  }
});

it('serializes import against mutations and cleans partial bytes on cancellation', async () => {
  const { readdirSync } = await import('node:fs');
  const controller = new AbortController();
  async function* chunks() {
    yield Buffer.concat([Buffer.from('POPBAK01'), Buffer.alloc(100)]);
    await expect(service.create()).rejects.toThrow('already running');
    expect(() => service.setPassword('another-backup-password')).toThrow('already running');
    expect(() => service.delete('missing')).toThrow('already running');
    controller.abort();
  }
  await expect(service.importArchive(chunks(), controller.signal)).rejects.toThrow();
  expect(readdirSync(backupsDir)).toEqual([]);
  expect(service.status().state).toBe('idle');
});

it('omits unsupported links only on explicit opt-in and records omissions in the encrypted snapshot', async () => {
  const outside = join(root, 'external-dependency'); writeFileSync(outside, 'do not copy');
  symlinkSync(outside, join(dataDir, 'external-link'));
  const info = await service.create({ skipUnsupportedLinks: true });
  const destination = join(root, 'portable'); mkdirSync(destination);
  const target = new TarBackupService({ dataDir: destination, backupsDir, now: () => new Date().toISOString() });
  await target.restore(info.name, password);
  expect(existsSync(join(destination, 'external-link'))).toBe(false);
  expect(JSON.parse(readFileSync(join(destination, '.pop-backup-omitted-links.json'), 'utf8'))).toEqual({ version: 1, paths: ['external-link'] });
  expect(readFileSync(join(dataDir, 'external-link'), 'utf8')).toBe('do not copy');
});
