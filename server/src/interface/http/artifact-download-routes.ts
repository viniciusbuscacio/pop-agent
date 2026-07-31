import { createReadStream } from 'node:fs';
import { Hono, type Context } from 'hono';
import type { ArtifactService } from '../../application/artifacts/artifact-service.js';
import { apiError } from './errors.js';

/**
 * The public download (popy.spec §14, RF-004–008). This route sits OUTSIDE
 * `/v1`, so it carries no session — the HMAC signature in the URL is the whole
 * authorisation. A bad or forged signature, an expired link or an unknown id
 * are all refused; nothing about the filesystem is ever revealed.
 */
export interface ArtifactDownloadRoutesDeps {
  artifacts: ArtifactService;
}

export function createArtifactDownloadRoutes(deps: ArtifactDownloadRoutesDeps): Hono {
  const routes = new Hono();

  routes.get('/artifacts/:id/download', (c) => {
    const resolution = deps.artifacts.resolveDownload(
      c.req.param('id'),
      c.req.query('expires'),
      c.req.query('sig'),
    );
    return serve(c, resolution);
  });

  routes.get('/artifacts/:id/versions/:version/download', (c) => {
    const version = Number(c.req.param('version'));
    if (!Number.isInteger(version)) return apiError(c, 403, 'forbidden', 'Invalid download link.');
    const resolution = deps.artifacts.resolveVersionDownload(
      c.req.param('id'),
      version,
      c.req.query('expires'),
      c.req.query('sig'),
    );
    return serve(c, resolution);
  });

  return routes;
}

function serve(
  c: Context,
  resolution: ReturnType<ArtifactService['resolveDownload']>,
): Response {
  switch (resolution.status) {
    case 'expired':
      return apiError(c, 410, 'link_expired', 'This download link has expired.');
    case 'not-found':
      return apiError(c, 404, 'not_found', 'No such artifact.');
    case 'malformed':
    case 'bad-signature':
      return apiError(c, 403, 'forbidden', 'Invalid download link.');
    case 'ok': {
      const { artifact, path } = resolution;
      return new Response(nodeStreamToWeb(createReadStream(path)), {
        headers: {
          'content-type': artifact.mime,
          'content-disposition': `attachment; filename="${sanitizeFilename(artifact.name)}"`,
          'cache-control': 'private, no-store',
        },
      });
    }
  }
}

/** Keeps the header well-formed: no quotes or control characters. */
function sanitizeFilename(name: string): string {
  // eslint-disable-next-line no-control-regex
  return name.replace(/["\r\n\u0000-\u001f]/g, '_') || 'download';
}

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
