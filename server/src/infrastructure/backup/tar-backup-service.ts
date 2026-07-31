import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { BackupInfo, BackupService } from '../../application/ports/backup-service.js';

/**
 * Backups as tar.gz files (popy.spec §16), made and restored with the system
 * tar. The secret key file is excluded on the way in, so a backup carries data
 * but no keys. The newest few are kept; older ones are pruned.
 *
 * Restore is deliberately blunt: extract over the data directory. Anything the
 * backup did not contain (the secret key, a newer file) is left in place. A
 * restart is needed for the running process to see it, which the route says.
 */

const KEEP = 10;
const SECRET_KEY_FILE = 'secret.key';
const PREFIX = 'popy-backup-';

export interface TarBackupDeps {
  dataDir: string;
  /** Where the tar.gz files live. Kept outside dataDir so a backup is not in a backup. */
  backupsDir: string;
  /** ISO timestamp for the file name; injected so it is not `new Date()` here. */
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

    // -C data dir, exclude the key, everything else in.
    execFileSync(
      'tar',
      ['-czf', target, '-C', this.deps.dataDir, `--exclude=${SECRET_KEY_FILE}`, '.'],
      { stdio: 'pipe' },
    );

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
    // A name is only ever one of our files: no path separators, right shape.
    return (
      name.startsWith(PREFIX) &&
      name.endsWith('.tar.gz') &&
      !name.includes('/') &&
      !name.includes('\\') &&
      !name.includes('..')
    );
  }

  private prune(): void {
    const extra = this.list().slice(KEEP);
    for (const backup of extra) this.delete(backup.name);
  }
}
