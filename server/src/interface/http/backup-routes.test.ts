import { describe, expect, it, vi } from 'vitest';
import type { BackupService } from '../../application/ports/backup-service.js';
import { createBackupRoutes } from './backup-routes.js';

function service(path: string | undefined): BackupService {
  return {
    passwordConfigured: () => false,
    setPassword: vi.fn(),
    list: () => [],
    create: () => Promise.resolve({ name: 'pop-backup-now.tar.gz', size: 1, createdAt: new Date(0).toISOString() }),
    pathOf: () => path,
    restore: vi.fn(() => Promise.resolve(true)),
    delete: () => false,
  };
}

describe('backup restore boundary', () => {
  it('never returns the saved password and requires matching confirmation', async () => {
    const backups = service(undefined);
    const app = createBackupRoutes({ backups });
    const send = (confirmation: string) => app.request('/backups/password', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'separate-password', confirmation }),
    });
    expect((await send('different-password')).status).toBe(400);
    expect(backups.setPassword).not.toHaveBeenCalled();
    const response = await send('separate-password');
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect(backups.setPassword).toHaveBeenCalledWith('separate-password');
    const list = await app.request('/backups');
    expect(await list.json()).toEqual({ backups: [], passwordConfigured: false, restoreAvailable: false });
  });
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

it('requires explicit confirmation and queues restore without touching the live database', async () => {
  const backups = service('/backups/pop-backup-now.popbackup');
  backups.canRestore = () => true;
  backups.requestRestore = vi.fn();
  const app = createBackupRoutes({ backups });
  const send = (body: unknown) => app.request('/backups/pop-backup-now.popbackup/restore', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  expect((await send({ password: 'archive-password' })).status).toBe(400);
  expect(backups.requestRestore).not.toHaveBeenCalled();
  const response = await send({ confirm: true, password: 'archive-password' });
  expect(response.status).toBe(202);
  expect(backups.requestRestore).toHaveBeenCalledWith('pop-backup-now.popbackup', 'archive-password');
  expect(backups.restore).not.toHaveBeenCalled();
  expect(await response.text()).not.toContain('archive-password');
});
