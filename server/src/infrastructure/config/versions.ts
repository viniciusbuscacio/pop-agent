import { readFileSync } from 'node:fs';

/**
 * Versions for Settings → About (docs/specs/Spec-Pop-General.md §13).
 *
 * The pi version is read from the dependency string in server/package.json
 * rather than by importing the SDK: About must answer instantly and must not
 * pull a large bundle into memory just to print a number. The dependency is
 * pinned exactly (docs/specs/Spec-Pop-General.md §15), so the string is the version.
 *
 * Both URLs resolve the same from src/ (tsx) and dist/ (compiled): each sits
 * the same depth below the server workspace.
 */
const SERVER_PACKAGE = new URL('../../../package.json', import.meta.url);
const GLOBAL_VERSION = new URL('../../../../VERSION', import.meta.url);
const PI_PACKAGE = '@earendil-works/pi-coding-agent';

export interface Versions {
  popAgentVersion: string;
  nodeVersion: string;
  piVersion: string;
}

export function readVersions(): Versions {
  return {
    popAgentVersion: globalVersion(),
    nodeVersion: process.version,
    piVersion: pinnedVersion(packageJson(SERVER_PACKAGE).dependencies?.[PI_PACKAGE]),
  };
}

interface PackageJson {
  version?: string;
  dependencies?: Record<string, string>;
}

function globalVersion(): string {
  try {
    return readFileSync(GLOBAL_VERSION, 'utf8').trim() || 'unknown';
  } catch {
    return 'unknown';
  }
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
