import { Hono } from 'hono';
import { createReadStream, statSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';

/**
 * The server hands out its own client (docs/cli.md, Distribution):
 *
 *     npm i -g https://your-pop-agent.example/cli-0.2.0.tgz
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
 * ONE version is served, this server's own. An old URL 404s rather than
 * quietly returning the new file: `cli-0.2.0.tgz` that installs 0.3.0 is
 * exactly the mismatch the version in the filename exists to prevent, and npm
 * caches by URL, so the lie would persist on disk.
 *
 * The file itself is built by `npm run pack:cli`; a server that has not been
 * packed answers 404, which reads correctly as "this server has no client to
 * give you" rather than as an error.
 */

export interface CliDownloadDeps {
  /** Directory holding the packed tarball (cli/pack). */
  cliPack: string;
  versions: { popAgentVersion: string };
}

export function createCliDownloadRoutes(deps: CliDownloadDeps): Hono {
  const routes = new Hono();

  routes.get('/:file{cli-[0-9A-Za-z.\\-]+\\.tgz}', (c) => {
    const expected = `cli-${deps.versions.popAgentVersion}.tgz`;
    if (c.req.param('file') !== expected) return c.notFound();

    // Joined with a constant, never with the parameter: the name above was
    // only ever compared, so there is no path for `..` to travel through.
    const path = join(deps.cliPack, expected);

    let size: number;
    try {
      size = statSync(path).size;
    } catch {
      return c.notFound();
    }

    return c.body(Readable.toWeb(createReadStream(path)) as ReadableStream, 200, {
      'content-type': 'application/gzip',
      'content-length': String(size),
      // Immutable because the version is in the name: this exact URL can
      // never mean a different file, which is the same property npm's own
      // URL cache relies on.
      'cache-control': 'public, max-age=31536000, immutable',
      'content-disposition': `attachment; filename="${expected}"`,
    });
  });

  return routes;
}
