import type { IntegrationService } from '../../application/integrations/integration-service.js';
import type { MiddlewareHandler } from 'hono';
import { SESSION_TOKEN_HEADER } from '@pop-agent/shared';
import type { AuthService } from '../../application/auth/auth-service.js';
import { apiError } from './errors.js';
import { publicV1PathSet } from './route-registry.js';

/**
 * Routes under /v1 that answer without a session: derived from the typed
 * route registry (docs/specs/Spec-Pop-General.md §9), never duplicated here. Each path's written
 * reason lives next to its declaration in route-registry.ts, and the probe
 * in route-guard.test.ts asserts nothing beyond that list slips through.
 */
const PUBLIC_PATHS: ReadonlySet<string> = publicV1PathSet();

/**
 * Bearer-token guard for /v1 (docs/specs/Spec-Pop-General.md §9). On a token past its first day it
 * also hands back a fresh one in `x-pop-agent-token`, which is what keeps a weekly
 * user from ever meeting the login screen.
 */
export function authMiddleware(auth: AuthService, integrations?: IntegrationService): MiddlewareHandler {
  return async (c, next) => {
    if (PUBLIC_PATHS.has(c.req.path)) return next();

    const header = c.req.header('Authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
    if (token.length === 0) {
      return apiError(c, 401, 'invalid_session', 'This request needs a valid session token.');
    }

    if (token.startsWith('popi_') && integrations !== undefined && c.req.path.startsWith('/v1/integration/')) {
      try { integrations.authenticate(token); } catch { return apiError(c, 401, 'invalid_integration_token', 'Invalid integration token.'); }
      return next();
    }

    const setupAcknowledgement = c.req.path === '/v1/setup/acknowledge';
    const result = setupAcknowledgement
      ? auth.verifySetupToken(token)
      : auth.verifySession(token);
    if (!result.ok) {
      return apiError(c, 401, 'invalid_session', 'This session is no longer valid. Sign in again.');
    }

    // A pending-setup credential must never be silently upgraded by renewal.
    const renewed = setupAcknowledgement ? undefined : auth.renewIfDue(result.payload);
    if (renewed !== undefined) c.header(SESSION_TOKEN_HEADER, renewed);

    return next();
  };
}
