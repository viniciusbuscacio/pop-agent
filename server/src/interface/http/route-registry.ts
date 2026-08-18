import { type Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';

/**
 * The typed route registry (docs/specs/Spec-Pop-General.md §9): the only way route groups reach
 * the app. A group is either session-guarded (mounted under /v1 behind the
 * auth middleware) or an explicitly declared public surface with a written
 * reason. TypeScript enforces the choice: `mountApi` does not accept a bare
 * Hono, so a future change cannot add an unauthenticated URL by accident --
 * it has to type `publicSurface('why this is safe', ...)`, which is loud and
 * greppable. The probe test in route-guard.test.ts closes the loop at
 * runtime: every mounted route must answer 401 without a session unless its
 * path is declared below.
 */

declare const sessionGuardedBrand: unique symbol;
declare const publicSurfaceBrand: unique symbol;

export type SessionGuardedRoutes = Hono & { readonly [sessionGuardedBrand]: true };

export interface PublicSurface {
  routes: Hono;
  /** One sentence on why answering without a session leaks nothing. */
  reason: string;
  readonly [publicSurfaceBrand]: true;
}

/** Bless a route group that must only ever answer behind the /v1 guard. */
export function sessionGuarded(routes: Hono): SessionGuardedRoutes {
  return routes as SessionGuardedRoutes;
}

/** Deliberately public routes. The reason is documentation with teeth. */
export function publicSurface(reason: string, routes: Hono): PublicSurface {
  return { routes, reason } as PublicSurface;
}

/**
 * Paths under the session guard that answer without a session, with the why.
 * Single source of truth: the auth middleware derives its allowlist from
 * here, and the probe test asserts nothing else slips through.
 */
export const PUBLIC_V1_PATHS: readonly { path: string; reason: string }[] = [
  { path: '/v1/health', reason: 'sidebar health dot; leaks only ok/error flags' },
  { path: '/v1/auth/state', reason: 'the login screen needs to know setup state' },
  { path: '/v1/setup', reason: 'first-run password creation happens pre-session' },
  { path: '/v1/login', reason: 'login is how a session is born' },
  { path: '/v1/auth/recover', reason: 'recovery runs exactly when the session is lost' },
  { path: '/v1/events', reason: 'EventSource cannot send headers; stream carries no data without a ticket' },
  { path: '/v1/auth/webauthn/login/options', reason: 'passkey unlock happens before there is a session (spec §9)' },
  { path: '/v1/auth/webauthn/login/verify', reason: 'passkey unlock happens before there is a session (spec §9)' },
];

export function publicV1PathSet(): ReadonlySet<string> {
  return new Set(PUBLIC_V1_PATHS.map((entry) => entry.path));
}

export interface ApiSurfaces {
  /** Mounted at '/' BEFORE the guard; each carries its own authorisation (HMAC) or none needed. */
  public: PublicSurface[];
  /** Mounted under /v1 AFTER the guard. */
  guarded: SessionGuardedRoutes[];
}

/** The single place routes meet the app; nothing else calls app.route. */
export function mountApi(app: Hono, guard: MiddlewareHandler, surfaces: ApiSurfaces): void {
  for (const surface of surfaces.public) app.route('/', surface.routes);
  app.use('/v1/*', guard);
  for (const routes of surfaces.guarded) app.route('/v1', routes);
}
