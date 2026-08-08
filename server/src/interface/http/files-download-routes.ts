import { createReadStream } from 'node:fs';
import { Hono } from 'hono';
import type { FilesService } from '../../application/files/files-service.js';
import { verifyFileDownload } from '../../application/files/files-download.js';
import type { Clock } from '../../application/ports/clock.js';
import { mimeOf } from '../../domain/files/mime.js';
import { inlineView } from '../../domain/files/inline-view.js';
import { apiError } from './errors.js';

/**
 * The public Files download (pop-agent.spec §14, "Files as a plain folder"). This
 * route sits OUTSIDE `/v1`, so it carries no session — the HMAC signature in
 * the URL is the whole authorisation, and it covers the path and the expiry
 * together. A bad or forged signature, an expired link, an unknown path or a
 * path the jail refuses are all denied.
 *
 * `?inline=1` asks to display rather than save (the Files screen's "Open
 * file"). It is a request, not an instruction: only the types
 * `domain/artifacts/inline-view` allows are shown, everything else still
 * downloads. The flag deliberately sits outside the signature — it cannot
 * reach anything the signature did not already authorise.
 */
export interface FilesDownloadRoutesDeps {
  files: FilesService;
  secretKey: Buffer;
  clock: Clock;
}

export function createFilesDownloadRoutes(deps: FilesDownloadRoutesDeps): Hono {
  const routes = new Hono();

  routes.get('/files/download', (c) => {
    const path = c.req.query('path');
    if (path === undefined || path.length === 0) {
      return apiError(c, 403, 'forbidden', 'Invalid download link.');
    }

    const check = verifyFileDownload(
      deps.secretKey,
      path,
      c.req.query('expires'),
      c.req.query('sig'),
      deps.clock.now(),
    );
    if (check === 'expired') {
      return apiError(c, 410, 'link_expired', 'This download link has expired.');
    }
    if (check !== 'ok') return apiError(c, 403, 'forbidden', 'Invalid download link.');

    // Signature first, filesystem second: only a link the server itself
    // minted ever reaches the jail, and the jail still gets the last word.
    let absolute: string;
    try {
      absolute = deps.files.absoluteOf(path);
    } catch {
      return apiError(c, 403, 'forbidden', 'Invalid download link.');
    }
    const stat = deps.files.stat(path);
    if (stat === undefined || stat.kind !== 'file') {
      return apiError(c, 404, 'not_found', 'No such file.');
    }

    const mime = mimeOf(path);
    const view = c.req.query('inline') === '1' ? inlineView(mime) : undefined;
    const filename = sanitizeFilename(path.split('/').at(-1) ?? 'download');
    return new Response(nodeStreamToWeb(createReadStream(absolute)), {
      headers: {
        'content-type': view?.contentType ?? mime,
        'content-disposition': `${view === undefined ? 'attachment' : 'inline'}; filename="${filename}"`,
        'cache-control': 'private, no-store',
        // Belt and braces for the inline case: nosniff stops the browser
        // from deciding these bytes are really HTML, and the sandbox denies
        // scripts and same-origin access to whatever does get rendered.
        'x-content-type-options': 'nosniff',
        'content-security-policy': 'sandbox',
      },
    });
  });

  return routes;
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
