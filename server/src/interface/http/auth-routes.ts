import { Hono, type Context } from 'hono';
import { z } from 'zod';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  type AuthService,
} from '../../application/auth/auth-service.js';
import type { Clock } from '../../application/ports/clock.js';
import type { LocalConnectionRegistry } from '../../application/local-access/local-connection-registry.js';
import { badBody, readJson, schemaError } from './body.js';
import { apiError } from './errors.js';
import { ProgressiveLockout } from './lockout.js';
import { SlidingWindowRateLimiter } from './rate-limit.js';

/**
 * Auth endpoints (docs/specs/Spec-Pop-General.md §9). Mounted under /v1.
 *
 * The credential routes carry two independent brakes: a sliding rate limit on
 * request volume, and a progressive lockout on wrong answers. `auth/state` is
 * deliberately outside both -- it reveals nothing, the app asks for it on every
 * boot, and throttling it would lock a user out by refreshing the page.
 */

const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;

const passwordField = z.string();

const setupSchema = z.object({ password: passwordField }).strict();
const loginSchema = z.object({ password: passwordField }).strict();
const recoverSchema = z.object({ recoveryKey: z.string(), newPassword: passwordField }).strict();
const changePasswordSchema = z
  .object({ currentPassword: passwordField, newPassword: passwordField })
  .strict();

export interface AuthRoutesDeps {
  auth: AuthService;
  clock: Clock;
  localConnections?: LocalConnectionRegistry;
}

export function createAuthRoutes(deps: AuthRoutesDeps): Hono {
  const routes = new Hono();
  const limiter = new SlidingWindowRateLimiter(RATE_LIMIT, RATE_WINDOW_MS, deps.clock);
  const lockout = new ProgressiveLockout(deps.clock);

  routes.get('/auth/state', (c) => c.json({ setupDone: deps.auth.isSetupDone() }));

  routes.post('/setup', async (c) => {
    const throttled = enforceRateLimit(c, limiter);
    if (throttled !== undefined) return throttled;

    const body = await readJson(c);
    if (body === undefined) return badBody(c);
    const parsed = setupSchema.safeParse(body);
    if (!parsed.success) return schemaError(c, parsed.error);

    const result = await deps.auth.setup(parsed.data.password);
    if (!result.ok) {
      return result.reason === 'already_setup'
        ? apiError(c, 409, 'already_setup', 'Pop Agent has already been set up on this server.')
        : weakPassword(c);
    }
    return c.json({ recoveryKey: result.recoveryKey, token: result.token });
  });

  routes.post('/login', async (c) => {
    const blocked = enforceRateLimit(c, limiter) ?? enforceLockout(c, lockout);
    if (blocked !== undefined) return blocked;

    const body = await readJson(c);
    if (body === undefined) return badBody(c);
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) return schemaError(c, parsed.error);

    const result = await deps.auth.login(parsed.data.password);
    if (!result.ok) {
      lockout.recordFailure();
      return invalidCredentials(c);
    }
    lockout.reset();
    return c.json({ token: result.token });
  });

  routes.post('/auth/recover', async (c) => {
    const blocked = enforceRateLimit(c, limiter) ?? enforceLockout(c, lockout);
    if (blocked !== undefined) return blocked;

    const body = await readJson(c);
    if (body === undefined) return badBody(c);
    const parsed = recoverSchema.safeParse(body);
    if (!parsed.success) return schemaError(c, parsed.error);

    const result = await deps.auth.recover(parsed.data.recoveryKey, parsed.data.newPassword);
    if (!result.ok) {
      if (result.reason === 'weak_password') return weakPassword(c);
      lockout.recordFailure();
      return invalidCredentials(c);
    }
    lockout.reset();
    deps.localConnections?.revokeAll();
    return c.json({ token: result.token, recoveryKey: result.recoveryKey });
  });

  // Authenticated from here: the middleware has already run.

  routes.post('/auth/change-password', async (c) => {
    const body = await readJson(c);
    if (body === undefined) return badBody(c);
    const parsed = changePasswordSchema.safeParse(body);
    if (!parsed.success) return schemaError(c, parsed.error);

    const result = await deps.auth.changePassword(
      parsed.data.currentPassword,
      parsed.data.newPassword,
    );
    if (!result.ok) {
      return result.reason === 'weak_password' ? weakPassword(c) : invalidCredentials(c);
    }
    deps.localConnections?.revokeAll();
    return c.json({ token: result.token });
  });

  routes.post('/auth/sign-out-others', (c) => {
    const result = deps.auth.signOutOthers();
    deps.localConnections?.revokeAll();
    return c.json(result);
  });

  // A no-body authenticated hop whose response may carry x-pop-agent-token
  // from the common middleware. Native clients use it to renew before a
  // long-lived local-tools connection reaches its original expiry.
  routes.post('/session/refresh', (c) => c.body(null, 204));

  return routes;
}

function weakPassword(c: Context): Response {
  return apiError(
    c,
    400,
    'weak_password',
    `Choose a password between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters.`,
  );
}

function invalidCredentials(c: Context): Response {
  return apiError(c, 401, 'invalid_credentials', 'That did not match. Try again.');
}

function enforceRateLimit(c: Context, limiter: SlidingWindowRateLimiter): Response | undefined {
  const decision = limiter.check(originOf(c));
  if (decision.allowed) return undefined;

  c.header('Retry-After', String(decision.retryAfterSeconds));
  return apiError(c, 429, 'rate_limited', 'Too many attempts. Wait a moment and try again.');
}

function enforceLockout(c: Context, lockout: ProgressiveLockout): Response | undefined {
  const status = lockout.status();
  if (!status.locked) return undefined;

  c.header('Retry-After', String(status.retryAfterSeconds));
  const body = {
    error: {
      code: 'locked',
      message: 'Too many failed attempts. Pop Agent is pausing sign-in for a moment.',
      status: 423,
    },
    retryAfterSeconds: status.retryAfterSeconds,
  };
  return c.json(body, 423);
}

/**
 * First hop of X-Forwarded-For when a proxy sets it. Behind `tailscale serve`
 * nothing does, so every caller shares one bucket -- fine for a single-user
 * app, and correct the day Pop Agent sits behind a real proxy.
 */
function originOf(c: Context): string {
  const forwarded = c.req.header('X-Forwarded-For');
  const first = forwarded?.split(',')[0]?.trim();
  return first !== undefined && first.length > 0 ? first : 'local';
}
