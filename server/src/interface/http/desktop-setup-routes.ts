import { createReadStream, lstatSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { Readable } from 'node:stream';
import { Hono } from 'hono';
import type {
  DesktopSetupReleaseResponse,
  DesktopSetupTicketResponse,
} from '@pop-agent/shared';
import type { EventTickets } from './event-tickets.js';

interface StoredSetupRelease {
  version: string;
  platform: 'darwin';
  arch: 'arm64';
  file: string;
  sha256: string;
  size: number;
}

export interface DesktopSetupDeps {
  desktopPack: string;
  tickets: EventTickets;
}

const manifestFile = 'setup-release.json';
const maximumManifestBytes = 64 * 1024;
const maximumSetupBytes = 256 * 1024 * 1024;
const ticketLifetimeSeconds = 60;

function readSetupRelease(pack: string): { stored: StoredSetupRelease; path: string } | undefined {
  try {
    const manifestPath = join(pack, manifestFile);
    const manifestStat = lstatSync(manifestPath);
    if (!manifestStat.isFile() || manifestStat.isSymbolicLink() || manifestStat.size > maximumManifestBytes) {
      return undefined;
    }
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as Partial<StoredSetupRelease>;
    if (
      typeof parsed.version !== 'string' ||
      !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(parsed.version) ||
      parsed.platform !== 'darwin' ||
      parsed.arch !== 'arm64' ||
      typeof parsed.file !== 'string' ||
      basename(parsed.file) !== parsed.file ||
      parsed.file !== `pop-desktop-setup-${parsed.version}-darwin-arm64.dmg` ||
      typeof parsed.sha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(parsed.sha256) ||
      typeof parsed.size !== 'number' ||
      !Number.isSafeInteger(parsed.size) ||
      parsed.size <= 0 ||
      parsed.size > maximumSetupBytes
    ) {
      return undefined;
    }
    const path = join(pack, parsed.file);
    const setupStat = lstatSync(path);
    if (!setupStat.isFile() || setupStat.isSymbolicLink() || setupStat.size !== parsed.size) return undefined;
    return { stored: parsed as StoredSetupRelease, path };
  } catch {
    return undefined;
  }
}

/** Session-guarded metadata and ticket issuance. */
export function createDesktopSetupReleaseRoutes(deps: DesktopSetupDeps): Hono {
  const routes = new Hono();

  routes.get('/desktop/setup/release', (c) => {
    const release = readSetupRelease(deps.desktopPack);
    if (release === undefined) return c.notFound();
    const result: DesktopSetupReleaseResponse = {
      version: release.stored.version,
      platform: release.stored.platform,
      arch: release.stored.arch,
      sha256: release.stored.sha256,
      size: release.stored.size,
    };
    return c.json(result);
  });

  routes.post('/desktop/setup/ticket', (c) => {
    if (readSetupRelease(deps.desktopPack) === undefined) return c.notFound();
    const ticket = deps.tickets.issue();
    const result: DesktopSetupTicketResponse = {
      downloadPath: `/desktop/setup/download?ticket=${encodeURIComponent(ticket)}`,
      expiresInSeconds: ticketLifetimeSeconds,
    };
    return c.json(result);
  });

  return routes;
}

/** Public byte stream authorised only by a one-use, short-lived ticket. */
export function createDesktopSetupDownloadRoutes(deps: DesktopSetupDeps): Hono {
  const routes = new Hono();
  routes.get('/desktop/setup/download', (c) => {
    if (!deps.tickets.consume(c.req.query('ticket'))) return c.notFound();
    const release = readSetupRelease(deps.desktopPack);
    if (release === undefined) return c.notFound();
    return c.body(Readable.toWeb(createReadStream(release.path)) as ReadableStream, 200, {
      'content-type': 'application/x-apple-diskimage',
      'content-length': String(release.stored.size),
      'cache-control': 'private, no-store',
      'content-disposition': 'attachment; filename="Pop Desktop Setup.dmg"',
      'x-content-type-options': 'nosniff',
    });
  });
  return routes;
}
