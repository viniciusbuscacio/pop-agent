import { describe, expect, it } from 'vitest';
import { createTestApp } from '../../testing/app-fixture.js';
import { PUBLIC_V1_PATHS, publicV1PathSet } from './route-registry.js';

/**
 * The probe half of the route-guard invariant (pop-agent.spec §9): walk every
 * route the app actually registered and fire it without a session. Anything
 * under /v1 that is not on the declared public list must answer 401 -- not
 * 200, not 400, not 404 -- because the guard runs before any handler or
 * body validation. This catches an unauthenticated URL no matter how it was
 * mounted; the typed registry makes the mistake hard, this test makes it
 * impossible to ship.
 */

/** Fill `:param` segments so the router matches the real handler. */
function probePath(routePath: string): string {
  return routePath.replace(/:[A-Za-z0-9_]+/g, 'probe');
}

describe('route guard', () => {
  it('answers 401 without a session on every /v1 route not declared public', async () => {
    const { app } = createTestApp();
    const publicPaths = publicV1PathSet();
    const seen = new Set<string>();
    const unguarded: string[] = [];

    for (const route of app.routes) {
      if (!route.path.startsWith('/v1/')) continue;
      if (route.path.includes('*')) continue; // middleware entries, not endpoints
      if (publicPaths.has(route.path)) continue;
      const key = `${route.method} ${route.path}`;
      if (route.method === 'ALL' || seen.has(key)) continue;
      seen.add(key);

      const response = await app.request(probePath(route.path), { method: route.method });
      if (response.status !== 401) {
        unguarded.push(`${key} -> ${response.status}`);
      }
    }

    expect(seen.size).toBeGreaterThan(20); // the walk found the real API, not an empty app
    expect(unguarded).toEqual([]);
  });

  it('declares every public path exactly once, with a reason', () => {
    const paths = PUBLIC_V1_PATHS.map((entry) => entry.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const entry of PUBLIC_V1_PATHS) {
      expect(entry.reason.length).toBeGreaterThan(10);
    }
  });

  it('file downloads without a valid signature answer 4xx, never content', async () => {
    // The download surface sits outside the session guard on purpose: the
    // HMAC in the URL is the whole authorisation (pop-agent.spec §14). So the
    // probe here is the complement: without a valid signature, nothing.
    const { app } = createTestApp();
    const paths = [
      '/files/download',
      '/files/download?path=probe.txt',
      '/files/download?path=probe.txt&expires=1&sig=bogus',
      '/files/download?path=..%2Fsecret.key&expires=1&sig=bogus',
    ];

    for (const path of paths) {
      const response = await app.request(path);
      expect(response.status, path).toBeGreaterThanOrEqual(400);
      expect(response.status, path).toBeLessThan(500);
    }
  });
});
