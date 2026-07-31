import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TarBackupService } from './tar-backup-service.js';

let root: string;
let dataDir: string;
let backupsDir: string;
let service: TarBackupService;
let clock = 1_700_000_000_000;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'popy-backup-test-'));
  dataDir = join(root, 'data');
  backupsDir = join(root, 'backups');
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, 'popy.db'), 'the database');
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
  it('creates a backup and lists it', () => {
    const info = service.create();
    expect(info.name).toMatch(/^popy-backup-.*\.tar\.gz$/);
    expect(info.size).toBeGreaterThan(0);
    expect(service.list().map((b) => b.name)).toContain(info.name);
  });

  it('excludes the secret key from the archive', () => {
    const info = service.create();
    // Extract into a fresh dir and confirm the key is not there.
    const out = join(root, 'out');
    mkdirSync(out);
    const path = service.pathOf(info.name);
    expect(path).toBeDefined();
    execFileSync('tar', ['-xzf', path as string, '-C', out]);
    expect(existsSync(join(out, 'popy.db'))).toBe(true);
    expect(existsSync(join(out, 'secret.key'))).toBe(false);
  });

  it('restores data over the data directory', () => {
    const info = service.create();
    writeFileSync(join(dataDir, 'popy.db'), 'changed after backup');

    expect(service.restore(info.name)).toBe(true);
    expect(readFileSync(join(dataDir, 'popy.db'), 'utf8')).toBe('the database');
    // The secret key, never in the backup, is left untouched.
    expect(readFileSync(join(dataDir, 'secret.key'), 'utf8')).toBe('TOP SECRET');
  });

  it('refuses a name with a path traversal', () => {
    expect(service.pathOf('../etc/passwd')).toBeUndefined();
    expect(service.restore('popy-backup-../x.tar.gz')).toBe(false);
  });

  it('deletes a backup', () => {
    const info = service.create();
    expect(service.delete(info.name)).toBe(true);
    expect(service.list()).toHaveLength(0);
  });
});
