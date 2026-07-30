import { readFileSync } from 'node:fs';

/**
 * Versions for Settings → About (popy.spec §13).
 *
 * The pi version is read from the dependency string in server/package.json
 * rather than by importing the SDK: About must answer instantly and must not
 * pull a large bundle into memory just to print a number. The dependency is
 * pinned exactly (popy.spec §15), so the string is the version.
 *
 * Both URLs resolve the same from src/ (tsx) and dist/ (compiled): each sits
 * the same depth below the server workspace.
 */
const SERVER_PACKAGE = new URL('../../../package.json', import.meta.url);
const ROOT_PACKAGE = new URL('../../../../package.json', import.meta.url);
const PI_PACKAGE = '@earendil-works/pi-coding-agent';

export interface Versions {
  popyVersion: string;
  nodeVersion: string;
  piVersion: string;
}

export function readVersions(): Versions {
  return {
    popyVersion: packageJson(ROOT_PACKAGE).version ?? 'unknown',
    nodeVersion: process.version,
    piVersion: pinnedVersion(packageJson(SERVER_PACKAGE).dependencies?.[PI_PACKAGE]),
  };
}

interface PackageJson {
  version?: string;
  dependencies?: Record<string, string>;
}

function packageJson(url: URL): PackageJson {
  try {
    return JSON.parse(readFileSync(url, 'utf8')) as PackageJson;
  } catch {
    return {};
  }
}

/** Tolerates a range prefix even though the dependency is meant to be pinned. */
function pinnedVersion(range: string | undefined): string {
  if (range === undefined || range.length === 0) return 'unknown';
  return range.replace(/^[\^~>=<\s]+/, '');
}
