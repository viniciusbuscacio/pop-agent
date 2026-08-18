import { describe, expect, it, vi } from 'vitest';
import type { BackupService } from '../../application/ports/backup-service.js';
import { createBackupRoutes } from './backup-routes.js';

function service(path: string | undefined): BackupService {
  return {
    list: () => [],
    create: () => Promise.resolve({ name: 'pop-backup-now.tar.gz', size: 1, createdAt: new Date(0).toISOString() }),
    pathOf: () => path,
    restore: vi.fn(() => true),
    delete: () => false,
  };
}

describe('backup restore boundary', () => {
  it('refuses to replace data through the live HTTP process', async () => {
    const backups = service('/backups/pop-backup-now.tar.gz');
    const response = await createBackupRoutes({ backups }).request('/backups/pop-backup-now.tar.gz/restore', {
      method: 'POST',
    });
    expect(response.status).toBe(409);
    expect(backups.restore).not.toHaveBeenCalled();
  });

  it('still reports an unknown backup as not found', async () => {
    const response = await createBackupRoutes({ backups: service(undefined) }).request('/backups/missing/restore', {
      method: 'POST',
    });
    expect(response.status).toBe(404);
  });
});
