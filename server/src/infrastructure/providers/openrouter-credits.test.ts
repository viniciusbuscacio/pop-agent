import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchOpenRouterCredits } from './openrouter-credits.js';

/**
 * The parser is the part that can drift (two endpoints, two shapes); the
 * network itself is stubbed.
 */
function stubFetch(responses: Record<string, { status: number; body: unknown }>): void {
  vi.stubGlobal('fetch', (url: unknown) => {
    const hit = responses[String(url)];
    if (hit === undefined) return Promise.resolve(new Response('nope', { status: 404 }));
    return Promise.resolve(new Response(JSON.stringify(hit.body), { status: hit.status }));
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('openrouter credits', () => {
  it('reads the documented /credits shape', async () => {
    stubFetch({
      'https://openrouter.ai/api/v1/credits': {
        status: 200,
        body: { data: { total_credits: 10, total_usage: 2.5 } },
      },
    });
    expect(await fetchOpenRouterCredits('key')).toEqual({ remaining: 7.5, used: 2.5 });
  });

  it('falls back to /auth/key when /credits fails', async () => {
    stubFetch({
      'https://openrouter.ai/api/v1/auth/key': {
        status: 200,
        body: { data: { limit: 20, usage: 5 } },
      },
    });
    expect(await fetchOpenRouterCredits('key')).toEqual({ remaining: 15, used: 5 });
  });

  it('an uncapped key has no meaningful remaining balance', async () => {
    stubFetch({
      'https://openrouter.ai/api/v1/auth/key': {
        status: 200,
        body: { data: { limit: null, usage: 5 } },
      },
    });
    expect(await fetchOpenRouterCredits('key')).toBeUndefined();
  });

  it('any failure hides: bad key, bad shape, network down', async () => {
    stubFetch({
      'https://openrouter.ai/api/v1/credits': { status: 401, body: { error: 'bad key' } },
    });
    expect(await fetchOpenRouterCredits('key')).toBeUndefined();

    vi.stubGlobal('fetch', () => Promise.reject(new Error('network down')));
    expect(await fetchOpenRouterCredits('key')).toBeUndefined();
  });
});
