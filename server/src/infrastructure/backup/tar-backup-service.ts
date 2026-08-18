import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { cp, mkdtemp, rm, stat } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import { promisify } from 'node:util';
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
const execFileAsync = promisify(execFile);

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

  async create(): Promise<BackupInfo> {
    const stamp = this.deps.now().replace(/[:.]/g, '-');
    const name = `${PREFIX}${stamp}.tar.gz`;
    const target = join(this.deps.backupsDir, name);
    const stagingRoot = await mkdtemp(join(this.deps.backupsDir, '.staging-'));
    const stagedData = join(stagingRoot, 'data');
    try {
      await cp(this.deps.dataDir, stagedData, {
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
      await snapshotDatabase(join(this.deps.dataDir, DATABASE_FILE), join(stagedData, DATABASE_FILE));
      await execFileAsync('tar', ['-czf', target, '-C', stagedData, '.']);
    } finally {
      await rm(stagingRoot, { recursive: true, force: true });
    }

    this.prune();
    const targetStat = await stat(target);
    return { name, size: targetStat.size, createdAt: targetStat.mtime.toISOString() };
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

async function snapshotDatabase(source: string, destination: string): Promise<void> {
  const database = new Database(source, { readonly: true, fileMustExist: true });
  try {
    await database.backup(destination);
  } finally {
    database.close();
  }
}
