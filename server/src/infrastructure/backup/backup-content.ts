import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BackupError } from '../../application/backup/backup-password.js';

export const BACKUP_CONTENT_FILE = '.pop-backup-content.json';

/** Missing metadata identifies older complete archives. Never infer restore policy from a filename. */
export function backupIncludesFiles(directory: string): boolean {
  const path = join(directory, BACKUP_CONTENT_FILE);
  if (!existsSync(path)) return true;
  try {
    const info = lstatSync(path);
    if (!info.isFile() || info.size > 512) throw new Error('invalid');
    const value = JSON.parse(readFileSync(path, 'utf8')) as { version?: unknown; includeFiles?: unknown };
    if (value.version !== 1 || typeof value.includeFiles !== 'boolean') throw new Error('invalid');
    return value.includeFiles;
  } catch { throw new BackupError('Backup content metadata is invalid.'); }
}
