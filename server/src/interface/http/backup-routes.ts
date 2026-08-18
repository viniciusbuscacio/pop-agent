import { createReadStream } from 'node:fs';
import { Hono } from 'hono';
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
    c.json({ backups: deps.backups.list().map(toDto) } satisfies BackupsResponse),
  );

  routes.post('/backups', (c) => c.json(toDto(deps.backups.create()), 201));

  routes.get('/backups/:name/download', (c) => {
    const name = c.req.param('name');
    const path = deps.backups.pathOf(name);
    if (path === undefined) return apiError(c, 404, 'not_found', 'No such backup.');

    const stream = nodeStreamToWeb(createReadStream(path));
    return new Response(stream, {
      headers: {
        'content-type': 'application/gzip',
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

function toDto(info: { name: string; size: number; createdAt: string }): BackupDTO {
  return { name: info.name, size: info.size, createdAt: info.createdAt };
}

/** Node's fs read stream as a web ReadableStream, for the Response body. */
function nodeStreamToWeb(stream: ReturnType<typeof createReadStream>): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      stream.on('data', (chunk) => controller.enqueue(new Uint8Array(chunk as Buffer)));
      stream.on('end', () => controller.close());
      stream.on('error', (error) => controller.error(error));
    },
    cancel() {
      stream.destroy();
    },
  });
}
