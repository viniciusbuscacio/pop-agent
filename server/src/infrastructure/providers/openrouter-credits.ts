/**
 * OpenRouter credit balance for Settings → Model (LOTE 6).
 *
 * `/credits` is the documented endpoint; `/auth/key` is the older fallback
 * whose payload names the fields differently. Any failure -- no key, network,
 * non-200, unexpected shape -- resolves to `undefined`, because the UI's
 * contract is "hide the line", never "break the card".
 */

export interface ProviderCredits {
  remaining: number;
  used: number;
}

const BASE = 'https://openrouter.ai/api/v1';
const TIMEOUT_MS = 5_000;

export async function fetchOpenRouterCredits(apiKey: string): Promise<ProviderCredits | undefined> {
  return (await tryCredits(apiKey)) ?? (await tryAuthKey(apiKey));
}

async function tryCredits(apiKey: string): Promise<ProviderCredits | undefined> {
  const body = await get(`${BASE}/credits`, apiKey);
  const data = body?.['data'];
  if (typeof data !== 'object' || data === null) return undefined;
  const total = (data as Record<string, unknown>)['total_credits'];
  const used = (data as Record<string, unknown>)['total_usage'];
  if (typeof total !== 'number' || typeof used !== 'number') return undefined;
  return { remaining: total - used, used };
}

async function tryAuthKey(apiKey: string): Promise<ProviderCredits | undefined> {
  const body = await get(`${BASE}/auth/key`, apiKey);
  const data = body?.['data'];
  if (typeof data !== 'object' || data === null) return undefined;
  const limit = (data as Record<string, unknown>)['limit'];
  const usage = (data as Record<string, unknown>)['usage'];
  if (typeof usage !== 'number') return undefined;
  // A null limit means "no cap": the remaining balance is not meaningful.
  if (typeof limit !== 'number') return undefined;
  return { remaining: limit - usage, used: usage };
}

async function get(url: string, apiKey: string): Promise<Record<string, unknown> | undefined> {
  try {
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return undefined;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
