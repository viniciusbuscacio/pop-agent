import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import Database from 'better-sqlite3';
import type { BackupInfo, BackupService } from '../../application/ports/backup-service.js';

/**
 * Portable tar.gz snapshots. The live SQLite database is copied with SQLite's
 * own snapshot machinery; raw db/WAL/SHM files are never copied independently.
 * Everything else is staged, excluding the encryption key. Restore is exposed
 * only to the offline manager command.
 */

const KEEP = 10;
const SECRET_KEY_FILE = 'secret.key';
const DATABASE_FILE = 'pop-agent.db';
const PREFIX = 'pop-backup-';

export interface TarBackupDeps {
  dataDir: string;
  backupsDir: string;
  now: () => string;
}

export class TarBackupService implements BackupService {
  constructor(private readonly deps: TarBackupDeps) {
    mkdirSync(deps.backupsDir, { recursive: true });
  }

  list(): BackupInfo[] {
    return readdirSync(this.deps.backupsDir)
      .filter((name) => name.startsWith(PREFIX) && name.endsWith('.tar.gz'))
      .map((name) => {
        const stat = statSync(join(this.deps.backupsDir, name));
        return { name, size: stat.size, createdAt: stat.mtime.toISOString() };
      })
      .sort((left, right) => right.name.localeCompare(left.name));
  }

  create(): BackupInfo {
    const stamp = this.deps.now().replace(/[:.]/g, '-');
    const name = `${PREFIX}${stamp}.tar.gz`;
    const target = join(this.deps.backupsDir, name);
    const stagingRoot = mkdtempSync(join(this.deps.backupsDir, '.staging-'));
    const stagedData = join(stagingRoot, 'data');
    try {
      cpSync(this.deps.dataDir, stagedData, {
        recursive: true,
        filter: (source) => {
          if (source === this.deps.dataDir) return true;
          const path = relative(this.deps.dataDir, source);
          if (path.includes('..')) return false;
          const rootName = path.split(/[\\/]/, 1)[0];
          return rootName !== SECRET_KEY_FILE && rootName !== DATABASE_FILE &&
            rootName !== `${DATABASE_FILE}-wal` && rootName !== `${DATABASE_FILE}-shm`;
        },
      });
      snapshotDatabase(join(this.deps.dataDir, DATABASE_FILE), join(stagedData, DATABASE_FILE));
      execFileSync('tar', ['-czf', target, '-C', stagedData, '.'], { stdio: 'pipe' });
    } finally {
      rmSync(stagingRoot, { recursive: true, force: true });
    }

    this.prune();
    const stat = statSync(target);
    return { name, size: stat.size, createdAt: stat.mtime.toISOString() };
  }

  pathOf(name: string): string | undefined {
    if (!this.valid(name)) return undefined;
    const path = join(this.deps.backupsDir, name);
    try {
      statSync(path);
      return path;
    } catch {
      return undefined;
    }
  }

  restore(name: string): boolean {
    const path = this.pathOf(name);
    if (path === undefined) return false;
    execFileSync('tar', ['-xzf', path, '-C', this.deps.dataDir], { stdio: 'pipe' });
    return true;
  }

  delete(name: string): boolean {
    const path = this.pathOf(name);
    if (path === undefined) return false;
    rmSync(path, { force: true });
    return true;
  }

  private valid(name: string): boolean {
    return (
      basename(name) === name &&
      name.startsWith(PREFIX) &&
      name.endsWith('.tar.gz') &&
      !name.includes('..')
    );
  }

  private prune(): void {
    const extra = this.list().slice(KEEP);
    for (const backup of extra) this.delete(backup.name);
  }
}

function snapshotDatabase(source: string, destination: string): void {
  const database = new Database(source, { readonly: true, fileMustExist: true });
  try {
    database.exec(`VACUUM INTO '${destination.replaceAll("'", "''")}'`);
  } finally {
    database.close();
  }
}
