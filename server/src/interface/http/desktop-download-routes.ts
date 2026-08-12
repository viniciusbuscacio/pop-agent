import { Hono } from 'hono';
import type { DesktopReleaseResponse } from '@pop-agent/shared';
import { createReadStream, lstatSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { Readable } from 'node:stream';

interface StoredRelease {
  version: string;
  platform: 'darwin';
  arch: 'arm64';
  file: string;
  sha256: string;
  size: number;
}

export interface DesktopDownloadDeps {
  /** Directory containing release.json and its immutable Pop Desktop zip. */
  desktopPack: string;
  /** Global Pop Agent version; desktop release publication must match it. */
  desktopReleaseVersion: string;
}

const releaseFile = 'release.json';
const maxManifestBytes = 64 * 1024;

function readRelease(pack: string, expectedVersion: string): { stored: StoredRelease; path: string } | undefined {
  try {
    const manifestPath = join(pack, releaseFile);
    const manifestStat = lstatSync(manifestPath);
    if (!manifestStat.isFile() || manifestStat.isSymbolicLink() || manifestStat.size > maxManifestBytes) return undefined;
    const raw = readFileSync(manifestPath);
    const parsed = JSON.parse(raw.toString('utf8')) as Partial<StoredRelease>;
    if (
      typeof parsed.version !== 'string' ||
      !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(parsed.version) ||
      parsed.version !== expectedVersion ||
      parsed.platform !== 'darwin' ||
      parsed.arch !== 'arm64' ||
      typeof parsed.file !== 'string' ||
      basename(parsed.file) !== parsed.file ||
      parsed.file !== `pop-desktop-${parsed.version}-darwin-arm64.zip` ||
      typeof parsed.sha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(parsed.sha256) ||
      typeof parsed.size !== 'number' ||
      !Number.isSafeInteger(parsed.size) ||
      parsed.size <= 0 ||
      parsed.size > 64 * 1024 * 1024
    ) {
      return undefined;
    }
    const path = join(pack, parsed.file);
    const packageStat = lstatSync(path);
    if (!packageStat.isFile() || packageStat.isSymbolicLink() || packageStat.size !== parsed.size) return undefined;
    return { stored: parsed as StoredRelease, path };
  } catch {
    return undefined;
  }
}

/** Authenticated distribution for the Manager-owned macOS desktop shell. */
export function createDesktopDownloadRoutes(deps: DesktopDownloadDeps): Hono {
  const routes = new Hono();

  routes.get('/desktop/release', (c) => {
    const release = readRelease(deps.desktopPack, deps.desktopReleaseVersion);
    if (release === undefined) return c.notFound();
    const result: DesktopReleaseResponse = {
      version: release.stored.version,
      platform: release.stored.platform,
      arch: release.stored.arch,
      sha256: release.stored.sha256,
      size: release.stored.size,
      downloadPath: `/v1/desktop/package/${release.stored.file}`,
    };
    return c.json(result);
  });

  routes.get('/desktop/package/:file{pop-desktop-[0-9A-Za-z.\\-]+\\.zip}', (c) => {
    const release = readRelease(deps.desktopPack, deps.desktopReleaseVersion);
    if (release === undefined || c.req.param('file') !== release.stored.file) return c.notFound();
    return c.body(Readable.toWeb(createReadStream(release.path)) as ReadableStream, 200, {
      'content-type': 'application/zip',
      'content-length': String(release.stored.size),
      'cache-control': 'private, max-age=31536000, immutable',
      'content-disposition': `attachment; filename="${release.stored.file}"`,
    });
  });

  return routes;
}
