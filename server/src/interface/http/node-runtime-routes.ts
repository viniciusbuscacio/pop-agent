import { createReadStream, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { Hono } from 'hono';

interface RuntimeArtifact {
  sourceUrl: string;
  file: string;
  size: number;
  sha256: string;
}

interface RuntimeRelease {
  version: string;
  minimumLauncherVersion: string;
  packages: Record<string, RuntimeArtifact>;
}

export interface NodeRuntimeRouteDeps {
  cliPack: string;
}

/**
 * Publishes the exact Node distribution selected and verified while packing
 * this server release. Clients trust only same-origin paths declared by this
 * manifest; arbitrary files under the pack directory are never exposed.
 */
export function createNodeRuntimeRoutes(deps: NodeRuntimeRouteDeps): Hono {
  const routes = new Hono();

  routes.get('/runtime/node/manifest.json', (c) => {
    const release = readRelease(deps.cliPack);
    if (release === undefined) return c.notFound();
    c.header('cache-control', 'no-store');
    return c.json(release);
  });

  routes.get('/runtime/node/:version/:file', (c) => {
    const release = readRelease(deps.cliPack);
    if (release === undefined || c.req.param('version') !== release.version) {
      return c.notFound();
    }
    const file = c.req.param('file');
    const artifact = Object.values(release.packages).find((entry) => entry.file === file);
    if (artifact === undefined) return c.notFound();

    const path = join(deps.cliPack, 'runtime', 'node', artifact.file);
    try {
      const size = statSync(path).size;
      if (size !== artifact.size) return c.notFound();
      return c.body(Readable.toWeb(createReadStream(path)) as ReadableStream, 200, {
        'content-type': artifact.file.endsWith('.zip') ? 'application/zip' : 'application/gzip',
        'content-length': String(size),
        'cache-control': 'public, max-age=31536000, immutable',
        'content-disposition': `attachment; filename="${artifact.file}"`,
      });
    } catch {
      return c.notFound();
    }
  });

  return routes;
}

function readRelease(cliPack: string): RuntimeRelease | undefined {
  try {
    const release = JSON.parse(
      readFileSync(join(cliPack, 'runtime', 'node', 'manifest.json'), 'utf8'),
    ) as RuntimeRelease;
    if (
      !/^\d+\.\d+\.\d+$/.test(release.version) ||
      !/^\d+\.\d+\.\d+$/.test(release.minimumLauncherVersion) ||
      release.packages === undefined ||
      Object.keys(release.packages).length === 0
    ) {
      return undefined;
    }
    for (const artifact of Object.values(release.packages)) {
      if (
        artifact.file.includes('/') ||
        artifact.file.includes('\\') ||
        artifact.size <= 0 ||
        !/^[a-f0-9]{64}$/.test(artifact.sha256) ||
        artifact.sourceUrl !== `https://nodejs.org/dist/v${release.version}/${artifact.file}`
      ) {
        return undefined;
      }
    }
    return release;
  } catch {
    return undefined;
  }
}
