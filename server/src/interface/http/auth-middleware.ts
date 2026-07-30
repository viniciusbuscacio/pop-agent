import type { MiddlewareHandler } from 'hono';
import { SESSION_TOKEN_HEADER } from '@popy/shared';
import type { AuthService } from '../../application/auth/auth-service.js';
import { apiError } from './errors.js';

/**
 * Routes under /v1 that answer without a session.
 *
 * `/v1/events` is here because EventSource cannot send an Authorization
 * header; authenticating the stream is a Phase 2 decision, and today it only
 * carries a hello-world.
 */
const PUBLIC_PATHS: ReadonlySet<string> = new Set([
  '/v1/auth/state',
  '/v1/setup',
  '/v1/login',
  '/v1/auth/recover',
  '/v1/events',
]);

/**
 * Bearer-token guard for /v1 (popy.spec §9). On a token past its first day it
 * also hands back a fresh one in `x-popy-token`, which is what keeps a weekly
 * user from ever meeting the login screen.
 */
export function authMiddleware(auth: AuthService): MiddlewareHandler {
  return async (c, next) => {
    if (PUBLIC_PATHS.has(c.req.path)) return next();

    const header = c.req.header('Authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
    if (token.length === 0) {
      return apiError(c, 401, 'invalid_session', 'This request needs a valid session token.');
    }

    const result = auth.verifySession(token);
    if (!result.ok) {
      return apiError(c, 401, 'invalid_session', 'This session is no longer valid. Sign in again.');
    }

    const renewed = auth.renewIfDue(result.payload);
    if (renewed !== undefined) c.header(SESSION_TOKEN_HEADER, renewed);

    return next();
  };
}
