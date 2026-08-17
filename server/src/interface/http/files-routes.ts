import { Hono } from 'hono';
import { z } from 'zod';
import type {
  FileLinkResponse,
  FileNodeDTO,
  FilesTreeResponse,
  FilesNameSearchResponse,
  GarbageEntryDTO,
  GarbageResponse,
} from '@pop-agent/shared';
import type { FileNode, FilesService } from '../../application/files/files-service.js';
import { buildFileLink } from '../../application/files/files-download.js';
import type { Clock } from '../../application/ports/clock.js';
import { apiError } from './errors.js';
import { badBody, readJson, schemaError } from './body.js';

/** An upload is capped so one request cannot fill the disk (docs/specs/Spec-Pop-General.md §14). */
const MAX_FILE_MB = 25;
const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;

/**
 * Files over HTTP, the authenticated half (docs/specs/Spec-Pop-General.md §14, "Files as a plain
 * folder"). The tree is the disk; every operation takes real relative paths.
 * The pathological paths (`..`, absolutes, dotfiles, reaching into Garbage)
 * are refused by the service's jail and surface here as 400s.
 */
export interface FilesRoutesDeps {
  files: FilesService;
  secretKey: Buffer;
  clock: Clock;
}

const pathSchema = z.object({ path: z.string().min(1) });
const moveSchema = z.object({ from: z.string().min(1), to: z.string().min(1) });

export function createFilesRoutes(deps: FilesRoutesDeps): Hono {
  const routes = new Hono();

  routes.get('/files', (c) =>
    c.json({ tree: deps.files.tree().map(toDto) } satisfies FilesTreeResponse),
  );

  // Name search stays server-side so the phone does not need the whole tree.
  routes.get('/files/search', (c) => {
    const query = c.req.query('q') ?? '';
    return c.json({
      hits: deps.files.searchNames(query),
    } satisfies FilesNameSearchResponse);
  });

  // Upload into a folder (the tab's Upload button). Multipart, so the bytes
  // are not base64-inflated across the wire; `dir` is the open folder's path.
  routes.post('/files', async (c) => {
    const body = await c.req.parseBody();
    const file = body['file'];
    if (!(file instanceof File)) {
      return apiError(c, 400, 'bad_request', 'Expected a "file" upload.');
    }
    const dir = typeof body['dir'] === 'string' ? body['dir'].trim() : '';

    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.length === 0) return apiError(c, 400, 'bad_request', 'The file is empty.');
    if (bytes.length > MAX_FILE_BYTES) {
      return apiError(c, 413, 'too_large', `Files must be ${String(MAX_FILE_MB)} MB or less.`);
    }

    const name = file.name.length > 0 ? file.name : 'upload';
    const path = dir === '' ? name : `${dir}/${name}`;
    return refusing(c, () => {
      deps.files.write(path, bytes);
      const node = nodeAt(deps.files, path);
      return node === undefined ? c.body(null, 201) : c.json(toDto(node), 201);
    });
  });

  routes.post('/files/folders', async (c) => {
    const body = await readJson(c);
    if (body === undefined) return badBody(c);
    const parsed = pathSchema.safeParse(body);
    if (!parsed.success) return schemaError(c, parsed.error);
    return refusing(c, () => {
      deps.files.mkdir(parsed.data.path);
      return c.body(null, 201);
    });
  });

  // Rename and move are the same operation now: a path edit.
  routes.post('/files/move', async (c) => {
    const body = await readJson(c);
    if (body === undefined) return badBody(c);
    const parsed = moveSchema.safeParse(body);
    if (!parsed.success) return schemaError(c, parsed.error);
    return refusing(c, () => {
      const outcome = deps.files.move(parsed.data.from, parsed.data.to);
      if (outcome === 'not-found') return apiError(c, 404, 'not_found', 'No such file.');
      if (outcome === 'target-exists') {
        return apiError(c, 409, 'name_taken', 'Something already has that name.');
      }
      return c.body(null, 204);
    });
  });

  // Mints the signed URL the PWA downloads through (docs/specs/Spec-Pop-General.md §14).
  routes.post('/files/link', async (c) => {
    const body = await readJson(c);
    if (body === undefined) return badBody(c);
    const parsed = pathSchema.safeParse(body);
    if (!parsed.success) return schemaError(c, parsed.error);
    return refusing(c, () => {
      const stat = deps.files.stat(parsed.data.path);
      if (stat === undefined || stat.kind !== 'file') {
        return apiError(c, 404, 'not_found', 'No such file.');
      }
      const link = buildFileLink(deps.secretKey, parsed.data.path, deps.clock.now());
      return c.json({ url: link.url, expiresAt: link.expiresAt } satisfies FileLinkResponse);
    });
  });

  // Delete = move into Garbage/ (docs/specs/Spec-Pop-General.md §14): reversible for thirty days.
  routes.delete('/files', (c) => {
    const path = c.req.query('path') ?? '';
    if (path.length === 0) return apiError(c, 400, 'bad_request', 'A path is required.');
    return refusing(c, () => {
      const removed = deps.files.remove(path);
      if (removed === 'not-found') {
        return apiError(c, 404, 'not_found', 'No such file.');
      }
      // The Garbage name can differ from the visible basename when two deleted
      // entries collide. Returning the exact handle makes immediate undo safe.
      return c.json(removed satisfies GarbageEntryDTO);
    });
  });

  routes.get('/trash', (c) =>
    c.json({
      entries: deps.files.listGarbage().map(
        (entry) =>
          ({
            name: entry.name,
            originalPath: entry.originalPath,
            kind: entry.kind,
            size: entry.size,
            deletedAt: entry.deletedAt,
            purgeAt: entry.purgeAt,
          }) satisfies GarbageEntryDTO,
      ),
    } satisfies GarbageResponse),
  );

  routes.post('/trash/:name/restore', (c) => {
    const outcome = deps.files.restore(c.req.param('name'));
    if (outcome === 'not-found') return apiError(c, 404, 'not_found', 'Not in the trash.');
    if (outcome === 'name-taken') {
      return apiError(c, 409, 'name_taken', 'A live file already has that path.');
    }
    return c.body(null, 204);
  });

  routes.delete('/trash/:name', (c) => {
    if (!deps.files.purge(c.req.param('name'))) {
      return apiError(c, 404, 'not_found', 'Not in the trash.');
    }
    return c.body(null, 204);
  });

  routes.delete('/trash', (c) => c.json({ purged: deps.files.emptyGarbage() }));

  return routes;
}

/** The jail throws on pathological paths; the API answer is a 400, not a 500. */
function refusing(
  c: Parameters<typeof apiError>[0],
  act: () => Response | Promise<Response>,
): Response | Promise<Response> {
  try {
    return act();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Bad path.';
    return apiError(c, 400, 'bad_request', message);
  }
}

function nodeAt(files: FilesService, path: string): FileNode | undefined {
  const stat = files.stat(path);
  if (stat === undefined) return undefined;
  const name = path.split('/').at(-1) ?? path;
  return { name, path, kind: stat.kind, size: stat.size, mtimeMs: stat.mtimeMs };
}

function toDto(node: FileNode): FileNodeDTO {
  return {
    name: node.name,
    path: node.path,
    kind: node.kind,
    size: node.size,
    mtime: new Date(node.mtimeMs).toISOString(),
    ...(node.children === undefined ? {} : { children: node.children.map(toDto) }),
  };
}
