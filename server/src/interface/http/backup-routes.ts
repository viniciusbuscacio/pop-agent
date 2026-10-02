import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { Hono } from 'hono';
import { z } from 'zod';
import { BACKUP_IMPORT_TIMEOUT_MS, BackupImportError, MAX_BACKUP_IMPORT_BYTES } from '../../application/backup/backup-import.js';
import { BackupError } from '../../application/backup/backup-password.js';
import type { BackupDTO, BackupsResponse } from '@pop-agent/shared';
import type { BackupService } from '../../application/ports/backup-service.js';
import { apiError } from './errors.js';

/** Browser restore only stages data; the next cold boot installs it offline. */
export interface BackupRoutesDeps {
  backups: BackupService;
}

export function createBackupRoutes(deps: BackupRoutesDeps): Hono {
  const routes = new Hono();

  routes.get('/backups', (c) => {
    c.header('Cache-Control', 'no-store');
    return c.json({ ...(deps.backups.importArchive ? { importMaxBytes: MAX_BACKUP_IMPORT_BYTES } : {}), fileSelectionAvailable: true, backups: deps.backups.list().map(toDto), passwordConfigured: deps.backups.passwordConfigured(),
      ...(deps.backups.status === undefined ? {} : { operation: deps.backups.status() }),
      restoreAvailable: deps.backups.canRestore?.() === true } satisfies BackupsResponse);
  });

  routes.post('/backups/import', async (c) => {
    if (!deps.backups.importArchive) return apiError(c, 409, 'operation_error', 'Backup import is unavailable.');
    if (c.req.header('content-type') !== 'application/octet-stream' || c.req.header('content-encoding')) {
      return apiError(c, 400, 'validation_error', 'Send a raw .popbackup file, not multipart or encoded content.');
    }
    const length = c.req.header('content-length');
    if (length !== undefined && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)))) {
      return apiError(c, 400, 'validation_error', 'Invalid backup length.');
    }
    if (length !== undefined && Number(length) > MAX_BACKUP_IMPORT_BYTES) {
      return apiError(c, 413, 'too_large', 'Backup exceeds the 10 GiB import limit.');
    }
    if (!c.req.raw.body) return apiError(c, 400, 'validation_error', 'Select a .popbackup file.');
    const signal = AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(BACKUP_IMPORT_TIMEOUT_MS)]);
    const source = Readable.fromWeb(c.req.raw.body as import('node:stream/web').ReadableStream<Uint8Array>);
    try {
      const result = await deps.backups.importArchive(source, signal);
      c.header('Cache-Control', 'no-store');
      return c.json(toDto(result), 201);
    } catch (error) {
      return apiError(c, error instanceof BackupImportError ? error.status : error instanceof BackupError ? 409 : signal.aborted ? 408 : 500,
        'operation_error', error instanceof BackupError ? error.message : signal.aborted ? 'Backup import cancelled or timed out.' : 'Could not import backup. Check disk space and retry.');
    } finally { source.destroy(); }
  });

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
    const text = await c.req.text();
    const parsed = z.object({ includeFiles: z.boolean().optional(), skipUnsupportedLinks: z.boolean().optional() }).strict().safeParse(
      text === '' ? {} : await Promise.resolve().then(() => JSON.parse(text) as unknown).catch(() => null),
    );
    if (!parsed.success) return apiError(c, 400, 'validation_error', 'Choose whether to include Files.');
    try { return c.json(toDto(await deps.backups.create({ ...(parsed.data.includeFiles === undefined ? {} : { includeFiles: parsed.data.includeFiles }), ...(parsed.data.skipUnsupportedLinks === undefined ? {} : { skipUnsupportedLinks: parsed.data.skipUnsupportedLinks }) })), 201); }
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

  routes.post('/backups/:name/restore', async (c) => {
    const name = c.req.param('name');
    if (deps.backups.pathOf(name) === undefined) return apiError(c, 404, 'not_found', 'No such backup.');
    if (deps.backups.requestRestore === undefined || !deps.backups.canRestore?.()) {
      return apiError(c, 409, 'operation_error', 'Browser restore requires the installed systemd service. Use popman restore instead.');
    }
    const parsed = z.object({ confirm: z.literal(true), password: z.string().min(1).max(128).optional() }).strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return apiError(c, 400, 'validation_error', 'Confirm the restore and provide the archive password.');
    try {
      deps.backups.requestRestore(name, parsed.data.password);
      c.header('Cache-Control', 'no-store');
      return c.json({ accepted: true }, 202);
    } catch (error) {
      return apiError(c, 409, 'operation_error', error instanceof BackupError ? error.message : 'Could not prepare restore.');
    }
  });

  routes.delete('/backups/:name', (c) => {
    try {
      return deps.backups.delete(c.req.param('name')) ? c.body(null, 204) : apiError(c, 404, 'not_found', 'No such backup.');
    } catch (error) {
      return apiError(c, 409, 'operation_error', error instanceof BackupError ? error.message : 'Could not delete backup.');
    }
  });

  return routes;
}

function toDto(info: { name: string; size: number; createdAt: string; encrypted?: boolean; includeFiles?: boolean | null }): BackupDTO {
  return { name: info.name, size: info.size, createdAt: info.createdAt, encrypted: info.encrypted === true, includeFiles: info.includeFiles === null ? null : info.includeFiles !== false };
}
