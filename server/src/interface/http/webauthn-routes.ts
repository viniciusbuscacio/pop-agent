import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { SESSION_TOKEN_HEADER } from '@popy/shared';
import type { AuthService } from '../../application/auth/auth-service.js';
import type { WebAuthnGateway } from '../../application/ports/webauthn-repo.js';
import { badBody, readJson } from './body.js';
import { apiError } from './errors.js';

/**
 * Passkey registration and login (popy.spec §9). Registration needs a session
 * -- only the signed-in user adds an authenticator. Login is public: proving a
 * passkey IS the authentication, and it hands back a session token like the
 * password login does. The relying-party id and origin come from the request
 * host, so the same install works on its LAN name and its tailnet name.
 */

const labelSchema = z.object({ label: z.string().max(80).optional() }).strict();

export interface WebAuthnRoutesDeps {
  auth: AuthService;
  webauthn: WebAuthnGateway;
}

export function createWebAuthnRoutes(deps: WebAuthnRoutesDeps): Hono {
  const routes = new Hono();

  routes.get('/auth/webauthn/credentials', (c) => c.json({ credentials: deps.webauthn.list() }));

  routes.delete('/auth/webauthn/credentials/:id', (c) => {
    deps.webauthn.remove(c.req.param('id'));
    return c.body(null, 204);
  });

  routes.post('/auth/webauthn/register/options', async (c) =>
    c.json(await deps.webauthn.registrationOptions(rpId(c))),
  );

  routes.post('/auth/webauthn/register/verify', async (c) => {
    const body = await readJson(c);
    if (body === undefined) return badBody(c);
    const meta = labelSchema.safeParse((body as { meta?: unknown }).meta ?? {});
    const label = meta.success ? (meta.data.label ?? 'Passkey') : 'Passkey';

    const ok = await deps.webauthn.verifyRegistration(
      (body as { response: never }).response,
      rpId(c),
      origin(c),
      label,
    );
    return ok ? c.json({ verified: true }) : registrationFailed(c);
  });

  routes.post('/auth/webauthn/login/options', async (c) => {
    if (!deps.webauthn.hasCredentials()) {
      return apiError(c, 404, 'not_found', 'No passkey is registered.');
    }
    return c.json(await deps.webauthn.authenticationOptions(rpId(c)));
  });

  routes.post('/auth/webauthn/login/verify', async (c) => {
    const body = await readJson(c);
    if (body === undefined) return badBody(c);

    const ok = await deps.webauthn.verifyAuthentication(
      (body as { response: never }).response,
      rpId(c),
      origin(c),
    );
    if (!ok) return apiError(c, 401, 'invalid_credentials', 'That passkey did not work.');

    const token = deps.auth.issueSessionToken();
    if (token === undefined) return apiError(c, 401, 'invalid_credentials', 'No account.');
    c.header(SESSION_TOKEN_HEADER, token);
    return c.json({ token });
  });

  return routes;
}

/** The relying-party id is the request host without the port. */
function rpId(c: Context): string {
  const host = c.req.header('host') ?? 'localhost';
  return host.split(':')[0] ?? 'localhost';
}

function origin(c: Context): string {
  const forwarded = c.req.header('x-forwarded-proto');
  const host = c.req.header('host') ?? 'localhost';
  const scheme = forwarded ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${scheme}://${host}`;
}

function registrationFailed(c: Context): Response {
  return apiError(c, 400, 'operation_error', 'The passkey could not be registered.');
}
