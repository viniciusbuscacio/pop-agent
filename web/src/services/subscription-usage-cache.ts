import type { ProviderSubscriptionUsageResponse } from '@pop-agent/shared';

const KEY = 'pop-agent.subscription-usage';
const cache = new Map<string, ProviderSubscriptionUsageResponse>();

/** Last successful display snapshot; refreshed by the provider screen. */
export function cachedSubscriptionUsage(providerId: string): ProviderSubscriptionUsageResponse | null {
  const hit = cache.get(providerId);
  if (hit) return hit;
  try {
    const stored = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as { providerId?: string; usage?: ProviderSubscriptionUsageResponse } | null;
    const usage = stored?.usage;
    if (stored?.providerId === providerId && usage && typeof usage.plan === 'string' &&
        [usage.primary, ...(usage.secondary ? [usage.secondary] : [])].every(window =>
          window && Number.isFinite(window.usedPercent) && Number.isFinite(window.windowSeconds) && Number.isFinite(window.resetAt))) {
      cache.set(providerId, usage);
      return usage;
    }
  } catch { /* Storage is optional and corrupt snapshots are disposable. */ }
  return null;
}

export function cacheSubscriptionUsage(providerId: string, usage: ProviderSubscriptionUsageResponse): void {
  cache.set(providerId, usage);
  try { sessionStorage.setItem(KEY, JSON.stringify({ providerId, usage })); } catch { /* Keep the in-memory snapshot. */ }
}

export function clearSubscriptionUsageCache(): void {
  cache.clear();
  try { sessionStorage.removeItem(KEY); } catch { /* Storage may be unavailable. */ }
}
