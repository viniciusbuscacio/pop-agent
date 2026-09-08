import type { SecretsRepo } from '../ports/secrets-repo.js';

export const BACKUP_PASSWORD_KEY = 'backup.archive-password';

export class BackupError extends Error {}

export function validateBackupPassword(password: string): void {
  if (password.length < 10 || password.length > 128 || password.trim().length === 0) {
    throw new BackupError('Use a backup password of 10–128 characters.');
  }
}

/** Independent of login; SecretsRepo encrypts this value with the host key. */
export class BackupPassword {
  constructor(private readonly secrets: SecretsRepo) {}

  configured(): boolean { return this.secrets.get(BACKUP_PASSWORD_KEY) !== undefined; }

  save(password: string): void {
    validateBackupPassword(password);
    this.secrets.set(BACKUP_PASSWORD_KEY, password);
  }

  read(): string {
    const password = this.secrets.get(BACKUP_PASSWORD_KEY);
    if (password === undefined) throw new BackupError('Set a backup password in Settings → Backup first.');
    return password;
  }
}
