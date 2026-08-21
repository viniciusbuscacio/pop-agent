import { Hono } from 'hono';
import { closeSync, constants, createReadStream, fstatSync, openSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { Readable } from 'node:stream';

/**
 * The server hands out its native launcher, release manifest and Node client
 * (docs/cli.md, Distribution). The native launcher is the primary path; the
 * npm-global URL below remains a migration path for old installations.
 *
 * The stable convenience URL redirects, without caching, to the server's exact
 * immutable package URL. That keeps copied setup commands useful after an
 * update without ever serving different tarball bytes from one cacheable URL.
 *
 * Unauthenticated, and it has to be: npm cannot log in. It fetches a URL with
 * no notion of a session, so a guarded route would simply fail with a 401
 * that npm reports as a broken tarball.
 *
 * What that exposes is worth stating plainly, since §18 is strict about new
 * public surface. The tarball is the client's own code -- no secrets, no
 * user data, nothing about this install except its version. Someone who
 * reaches the address learns a Pop Agent answers there, which is already true of
 * the login page at the same host. The install is not public in practice
 * anyway: it is behind the tailnet, which is where §18(b) puts it.
 *
 * The pack's package.json selects the latest immutable release for discovery
 * and the convenience alias. It may trail the server briefly while a new CLI
 * is being packed; compatibility negotiation decides whether it can attach.
 * Older immutable archives remain available at their exact versioned URLs, and
 * malformed, missing or non-regular archive names are refused.
 *
 * The file itself is built by `npm run pack:cli`; a server that has not been
 * packed answers 404, which reads correctly as "this server has no client to
 * give you" rather than as an error.
 */

export interface CliDownloadDeps {
  /** Directory holding the current packed tarball and release manifests. */
  cliPack: string;
  /** Durable history of immutable CLI tarballs across checkout replacement. */
  cliArchive?: string;
  versions: { popAgentVersion: string };
}

export function createCliDownloadRoutes(deps: CliDownloadDeps): Hono {
  const routes = new Hono();

  routes.get('/cli/manifest.json', (c) => {
    const release = packedCliRelease(deps.cliPack);
    if (release === undefined) return c.notFound();
    c.header('cache-control', 'no-store');
    return c.json({
      version: release.version,
      minimumNodeVersion: '22.19.0',
      minimumLauncherVersion: '1.0.0',
      package: {
        url: `/${release.file}`,
        size: release.bytes.length,
        sha256: createHash('sha256').update(release.bytes).digest('hex'),
      },
    });
  });

  routes.get('/cli/launcher/manifest.json', (c) => {
    try {
      const body = readFileSync(join(deps.cliPack, 'launcher', 'manifest.json'));
      return c.body(body, 200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      });
    } catch {
      return c.notFound();
    }
  });

  routes.get('/cli/launcher/:file{pop-launcher-[0-9A-Za-z.\\-]+}', (c) => {
    const manifestPath = join(deps.cliPack, 'launcher', 'manifest.json');
    try {
      const release = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        artifacts?: Record<string, { file?: string }>;
      };
      const allowed = Object.values(release.artifacts ?? {}).some(
        (artifact) => artifact.file === c.req.param('file'),
      );
      if (!allowed) return c.notFound();
      const path = join(deps.cliPack, 'launcher', c.req.param('file'));
      const size = statSync(path).size;
      return c.body(Readable.toWeb(createReadStream(path)) as ReadableStream, 200, {
        'content-type': 'application/octet-stream',
        'content-length': String(size),
        'cache-control': 'public, max-age=31536000, immutable',
        'content-disposition': `attachment; filename="${c.req.param('file')}"`,
      });
    } catch {
      return c.notFound();
    }
  });

  routes.get('/cli-latest.tgz', (c) => {
    const release = packedCliRelease(deps.cliPack);
    if (release === undefined) return c.notFound();
    c.header('cache-control', 'no-store');
    return c.redirect(`/${release.file}`, 307);
  });

  routes.get('/:file{cli-[0-9A-Za-z.\\-]+\\.tgz}', (c) => {
    const release = versionedCliRelease(
      [deps.cliPack, ...(deps.cliArchive === undefined ? [] : [deps.cliArchive])],
      c.req.param('file'),
    );
    if (release === undefined) return c.notFound();

    return c.body(Uint8Array.from(release.bytes), 200, {
      'content-type': 'application/gzip',
      'content-length': String(release.bytes.length),
      // Immutable because release packaging never replaces bytes at an
      // existing versioned URL.
      'cache-control': 'public, max-age=31536000, immutable',
      'content-disposition': `attachment; filename="${release.file}"`,
    });
  });

  return routes;
}

function packedCliRelease(cliPack: string): { version: string; file: string; bytes: Buffer } | undefined {
  try {
    const manifest = JSON.parse(readFileSync(join(cliPack, 'package.json'), 'utf8')) as { version?: unknown };
    if (typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(manifest.version)) return undefined;
    return versionedCliRelease([cliPack], `cli-${manifest.version}.tgz`);
  } catch {
    return undefined;
  }
}

function versionedCliRelease(
  directories: string[],
  file: string,
): { version: string; file: string; bytes: Buffer } | undefined {
  const match = /^cli-(\d+\.\d+\.\d+)\.tgz$/.exec(file);
  if (match?.[1] === undefined) return undefined;
  for (const directory of directories) {
    let descriptor: number | undefined;
    try {
      descriptor = openSync(join(directory, file), constants.O_RDONLY | constants.O_NOFOLLOW);
      if (!fstatSync(descriptor).isFile()) continue;
      // Read and serve the exact descriptor validated above. The pathname is
      // never reopened after a symlink or replacement race could intervene.
      return { version: match[1], file, bytes: readFileSync(descriptor) };
    } catch {
      // Try the durable archive after a missing checkout-local release.
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
  }
  return undefined;
}
