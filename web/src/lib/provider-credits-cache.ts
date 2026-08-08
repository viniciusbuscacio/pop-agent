export type ProviderCredits = { remaining: number; used: number };

type CacheEntry =
  | { kind: 'ok'; data: ProviderCredits; at: number }
  | { kind: 'none'; at: number };

const TTL_MS = 60_000;

const cache = new Map<string, CacheEntry>();
let boundListVersion = -1;

function fresh(entry: CacheEntry): boolean {
  return Date.now() - entry.at < TTL_MS;
}

function bindListVersion(listVersion: number): void {
  if (boundListVersion === listVersion) return;
  cache.clear();
  boundListVersion = listVersion;
}

/**
 * One fetch per provider per list version, within a minute. A missing balance
 * endpoint (404) is cached as "none" so re-renders and remounts stay silent
 * without paying the round-trip again.
 */
export async function loadProviderCredits(
  providerId: string,
  listVersion: number,
  fetch: (id: string) => Promise<ProviderCredits>,
): Promise<ProviderCredits | null> {
  bindListVersion(listVersion);

  const hit = cache.get(providerId);
  if (hit !== undefined && fresh(hit)) {
    return hit.kind === 'ok' ? hit.data : null;
  }

  try {
    const data = await fetch(providerId);
    cache.set(providerId, { kind: 'ok', data, at: Date.now() });
    return data;
  } catch {
    cache.set(providerId, { kind: 'none', at: Date.now() });
    return null;
  }
}

/** Test hook: reset module state between cases. */
export function resetProviderCreditsCacheForTests(): void {
  cache.clear();
  boundListVersion = -1;
}
