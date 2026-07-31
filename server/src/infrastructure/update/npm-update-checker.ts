import { execFile } from 'node:child_process';
import type { UpdateChecker, UpdateStatus } from '../../application/ports/update-checker.js';
import type { Versions } from '../config/versions.js';

/**
 * The update check (popy.spec §15): current versions, plus the latest pi on
 * the npm registry and the latest Popy tag on the git origin -- knowing a new
 * version exists is worth a cheap request, applying it stays a documented
 * shell procedure gated by `npm run gate`. Results are cached briefly so
 * opening Settings repeatedly does not hammer anyone, and a failed check just
 * leaves `latest` undefined rather than erroring.
 */

const PI_PACKAGE = '@earendil-works/pi-coding-agent';
const REGISTRY = 'https://registry.npmjs.org';
const CACHE_MS = 60 * 60 * 1000;
const TIMEOUT_MS = 8000;

const UPDATE_COMMAND = 'cd ~/dev/popy && git pull && npm ci && npm run gate && sudo systemctl restart popy-dev';

export interface NpmUpdateCheckerDeps {
  versions: Versions;
  now: () => number;
  /** Injectable so tests do not hit the network. */
  fetchLatest?: (pkg: string) => Promise<string | undefined>;
  /** Injectable so tests do not need a git remote. */
  fetchLatestTag?: () => Promise<string | undefined>;
  /** Environment tool versions; resolved once and reused. */
  environment?: () => Promise<{ name: string; version: string }[]>;
}

export class NpmUpdateChecker implements UpdateChecker {
  private cache: { at: number; latest: string | undefined } | undefined;
  private tagCache: { at: number; latest: string | undefined } | undefined;
  private envCache: { name: string; version: string }[] | undefined;

  constructor(private readonly deps: NpmUpdateCheckerDeps) {}

  async status(): Promise<UpdateStatus> {
    return {
      pi: { current: this.deps.versions.piVersion, latest: await this.piLatest() },
      popy: { current: this.deps.versions.popyVersion, latest: await this.popyLatest() },
      node: this.deps.versions.nodeVersion,
      environment: await this.environmentVersions(),
      updateCommand: UPDATE_COMMAND,
    };
  }

  private async piLatest(): Promise<string | undefined> {
    if (this.cache !== undefined && this.deps.now() - this.cache.at < CACHE_MS) {
      return this.cache.latest;
    }
    const fetcher = this.deps.fetchLatest ?? defaultFetchLatest;
    const latest = await fetcher(PI_PACKAGE).catch(() => undefined);
    this.cache = { at: this.deps.now(), latest };
    return latest;
  }

  private async popyLatest(): Promise<string | undefined> {
    if (this.tagCache !== undefined && this.deps.now() - this.tagCache.at < CACHE_MS) {
      return this.tagCache.latest;
    }
    const fetcher = this.deps.fetchLatestTag ?? defaultFetchLatestTag;
    const latest = await fetcher().catch(() => undefined);
    this.tagCache = { at: this.deps.now(), latest };
    return latest;
  }

  private async environmentVersions(): Promise<{ name: string; version: string }[]> {
    if (this.envCache !== undefined) return this.envCache;
    this.envCache = await (this.deps.environment?.() ?? Promise.resolve([]));
    return this.envCache;
  }
}

async function defaultFetchLatest(pkg: string): Promise<string | undefined> {
  const response = await fetch(`${REGISTRY}/${pkg}/latest`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) return undefined;
  const body = (await response.json()) as { version?: string };
  return body.version;
}

/** The newest `vX.Y.Z` tag on the origin, asked with the repo's own deploy key. */
async function defaultFetchLatestTag(): Promise<string | undefined> {
  const output = await new Promise<string>((resolve, reject) => {
    execFile(
      'git',
      ['ls-remote', '--tags', 'origin'],
      { timeout: TIMEOUT_MS },
      (error, stdout) => {
        if (error !== null) reject(error);
        else resolve(stdout);
      },
    );
  });
  return latestSemverTag(output);
}

/** Picks the highest `vX.Y.Z` from `git ls-remote --tags` output. Exported for tests. */
export function latestSemverTag(output: string): string | undefined {
  const versions = [...output.matchAll(/refs\/tags\/v(\d+)\.(\d+)\.(\d+)$/gm)].map(
    (match) => [Number(match[1]), Number(match[2]), Number(match[3])] as [number, number, number],
  );
  if (versions.length === 0) return undefined;
  versions.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  const top = versions[versions.length - 1];
  return top === undefined ? undefined : `${String(top[0])}.${String(top[1])}.${String(top[2])}`;
}

/** True when `latest` is a strictly newer x.y.z than `current`. */
export function isNewerVersion(current: string, latest: string): boolean {
  const parse = (value: string): number[] =>
    value
      .replace(/^v/, '')
      .split('.')
      .map((part) => Number(part) || 0);
  const a = parse(current);
  const b = parse(latest);
  for (let i = 0; i < 3; i++) {
    const diff = (b[i] ?? 0) - (a[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}
