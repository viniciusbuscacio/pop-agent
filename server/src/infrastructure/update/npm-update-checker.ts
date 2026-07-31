import type { UpdateChecker, UpdateStatus } from '../../application/ports/update-checker.js';
import type { Versions } from '../config/versions.js';

/**
 * The update check (popy.spec §15): current versions, and the latest pi on the
 * npm registry -- pi is the sensitive channel, since a pi release can break
 * Popy, so knowing a new one exists is worth a single cheap request. The result
 * is cached briefly so opening Settings repeatedly does not hammer the registry,
 * and a failed check just leaves `latest` undefined rather than erroring.
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
}

export class NpmUpdateChecker implements UpdateChecker {
  private cache: { at: number; latest: string | undefined } | undefined;

  constructor(private readonly deps: NpmUpdateCheckerDeps) {}

  async status(): Promise<UpdateStatus> {
    return {
      pi: { current: this.deps.versions.piVersion, latest: await this.piLatest() },
      popy: { current: this.deps.versions.popyVersion },
      node: this.deps.versions.nodeVersion,
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
}

async function defaultFetchLatest(pkg: string): Promise<string | undefined> {
  const response = await fetch(`${REGISTRY}/${pkg}/latest`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) return undefined;
  const body = (await response.json()) as { version?: string };
  return body.version;
}
