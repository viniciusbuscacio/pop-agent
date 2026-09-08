import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { Hono } from 'hono';
import { z } from 'zod';
import { BackupError } from '../../application/backup/backup-password.js';
import type { BackupDTO, BackupsResponse } from '@pop-agent/shared';
import type { BackupService } from '../../application/ports/backup-service.js';
import { apiError } from './errors.js';

/**
 * Backup and restore over HTTP (docs/specs/Spec-Pop-General.md §16). Settings → Backup lists the
 * snapshots, makes one, downloads one and deletes one. Restore is deliberately
 * unavailable in the live process: replacing SQLite beneath open repositories
 * can combine old in-memory state with restored files. `popman restore` stops
 * the service around extraction instead.
 */
export interface BackupRoutesDeps {
  backups: BackupService;
}

export function createBackupRoutes(deps: BackupRoutesDeps): Hono {
  const routes = new Hono();

  routes.get('/backups', (c) =>
    c.json({ backups: deps.backups.list().map(toDto), passwordConfigured: deps.backups.passwordConfigured() } satisfies BackupsResponse),
  );

  routes.put('/backups/password', async (c) => {
    const parsed = z.object({ password: z.string().min(10).max(128), confirmation: z.string().max(128) }).strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success || parsed.data.password !== parsed.data.confirmation) {
      return apiError(c, 400, 'validation_error', 'Use matching backup passwords of 10–128 characters.');
    }
    try {
      deps.backups.setPassword(parsed.data.password);
      c.header('Cache-Control', 'no-store');
      return c.body(null, 204);
    } catch (error) {
      return apiError(c, 409, 'operation_error', error instanceof BackupError ? error.message : 'Could not save backup password.');
    }
  });

  routes.post('/backups', async (c) => {
    try { return c.json(toDto(await deps.backups.create()), 201); }
    catch (error) {
      return apiError(c, error instanceof BackupError ? 409 : 500, 'operation_error',
        error instanceof BackupError ? error.message : 'Could not create backup.');
    }
  });

  routes.get('/backups/:name/download', (c) => {
    const name = c.req.param('name');
    const path = deps.backups.pathOf(name);
    if (path === undefined) return apiError(c, 404, 'not_found', 'No such backup.');

    const stream = Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>;
    return new Response(stream, {
      headers: {
        'content-type': name.endsWith('.popbackup') ? 'application/octet-stream' : 'application/gzip',
        'cache-control': 'no-store',
        'content-disposition': `attachment; filename="${name}"`,
      },
    });
  });

  routes.post('/backups/:name/restore', (c) => {
    if (deps.backups.pathOf(c.req.param('name')) === undefined) {
      return apiError(c, 404, 'not_found', 'No such backup.');
    }
    return apiError(
      c,
      409,
      'operation_error',
      'Restore requires the offline operator command: popman restore <backup>.',
    );
  });

  routes.delete('/backups/:name', (c) =>
    deps.backups.delete(c.req.param('name'))
      ? c.body(null, 204)
      : apiError(c, 404, 'not_found', 'No such backup.'),
  );

  return routes;
}

function toDto(info: { name: string; size: number; createdAt: string; encrypted?: boolean }): BackupDTO {
  return { name: info.name, size: info.size, createdAt: info.createdAt, encrypted: info.encrypted === true };
}
