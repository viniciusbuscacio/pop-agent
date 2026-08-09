import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import type { MiddlewareHandler } from 'hono';

/**
 * Serves the built frontend from web/dist, with the fallback every single-page
 * app needs: a deep link like /settings is not a file, so it gets index.html
 * and the router takes it from there.
 *
 * API paths are left alone -- they must 404 as JSON, not as an HTML page.
 */

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

export function createStaticSite(distDir: string): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return next();

    const path = c.req.path;
    if (path.startsWith('/v1/') || path === '/healthz') return next();
    if (safelyDecode(path) === undefined) return next();

    const asset = await readAsset(distDir, path);
    if (asset !== undefined) {
      return c.body(new Uint8Array(asset.body), 200, {
        'content-type': asset.contentType,
        'cache-control': cacheControl(path),
      });
    }

    // Not a file: hand back the shell so client-side routing can resolve it.
    const shell = await readAsset(distDir, '/index.html');
    if (shell === undefined) return next();
    return c.body(new Uint8Array(shell.body), 200, {
      'content-type': shell.contentType,
      // A navigation must always fetch a fresh shell, or a new build's hashed
      // asset names are never picked up.
      'cache-control': 'no-cache',
    });
  };
}

/**
 * Cache policy that lets updates actually land (pop-agent.spec §15). Hashed build
 * assets are content-addressed and safe to cache forever; everything else --
 * crucially sw.js and the HTML shell -- must be revalidated every time, or a
 * heuristic cache can keep serving a stale worker and the PWA never sees a new
 * version. `no-cache` still caches, it just always revalidates first.
 */
function cacheControl(urlPath: string): string {
  const name = safelyDecode(urlPath)?.replace(/^\/+/, '') ?? '';
  if (name.startsWith('assets/')) return 'public, max-age=31536000, immutable';
  return 'no-cache';
}

interface Asset {
  body: Buffer;
  contentType: string;
}

async function readAsset(distDir: string, urlPath: string): Promise<Asset | undefined> {
  const decoded = safelyDecode(urlPath);
  if (decoded === undefined) return undefined;
  const relative = decoded.replace(/^\/+/, '');
  if (relative.length === 0) return readAsset(distDir, '/index.html');

  // Normalise before touching the disk: `..` in a URL must not escape dist.
  const target = normalize(join(distDir, relative));
  if (!target.startsWith(distDir.endsWith(sep) ? distDir : distDir + sep)) return undefined;

  try {
    const body = await readFile(target);
    return { body, contentType: CONTENT_TYPES[extname(target)] ?? 'application/octet-stream' };
  } catch {
    return undefined;
  }
}

/** Invalid percent escapes are a bad URL, not an exception worth a 500. */
function safelyDecode(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}
