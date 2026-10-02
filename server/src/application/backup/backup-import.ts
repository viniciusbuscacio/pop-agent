import { BackupError } from './backup-password.js';

export const MAX_BACKUP_IMPORT_BYTES = 10 * 1024 ** 3;
export const BACKUP_IMPORT_TIMEOUT_MS = 2 * 60 * 60 * 1000;

export class BackupImportError extends BackupError {
  constructor(message: string, readonly status: 400 | 413) { super(message); }
}
