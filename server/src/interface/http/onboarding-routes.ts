import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { ServerOnboardingService } from '../../application/onboarding/server-onboarding-service.js';
import { badBody, readJson, schemaError } from './body.js';
import { apiError } from './errors.js';

export const ONBOARDING_TOKEN_HEADER = 'X-Pop-Onboarding-Token';

const pairSchema = z.object({ code: z.string().min(1).max(64) }).strict();
const httpsSchema = z.object({
  acceptCertificateTransparency: z.boolean(),
  hostname: z.string().min(1).max(63).optional(),
}).strict();

export function createOnboardingRoutes(service: ServerOnboardingService): Hono {
  const routes = new Hono();

  routes.get('/onboarding/public', (c) => c.json(service.publicState()));

  routes.post('/onboarding/pair', async (c) => {
    const body = await readJson(c);
    if (body === undefined) return badBody(c);
    const parsed = pairSchema.safeParse(body);
    if (!parsed.success) return schemaError(c, parsed.error);
    const result = service.pair(parsed.data.code);
    if (result.ok) return c.json({ token: result.token, state: result.state });
    if (result.reason === 'expired') {
      return apiError(c, 410, 'onboarding_code_expired', 'The setup code expired. Run popman onboarding-code on the server.');
    }
    if (result.reason === 'locked') {
      return apiError(c, 429, 'onboarding_locked', 'Too many attempts. Wait one minute and try again.');
    }
    if (result.reason === 'not_required') {
      return apiError(c, 409, 'onboarding_not_required', 'Network onboarding is already complete.');
    }
    return apiError(c, 401, 'invalid_onboarding_code', 'That setup code did not match.');
  });

  routes.get('/onboarding/state', (c) => {
    const state = service.state(onboardingToken(c));
    return state === undefined
      ? apiError(c, 401, 'invalid_onboarding_token', 'Pair this browser with the server first.')
      : c.json(state);
  });

  routes.post('/onboarding/tailscale/connect', async (c) => {
    try {
      const state = await service.connect(onboardingToken(c));
      return state === undefined
        ? apiError(c, 401, 'invalid_onboarding_token', 'Pair this browser with the server first.')
        : c.json(state);
    } catch {
      return apiError(c, 502, 'tailscale_failed', 'Tailscale did not provide a login link. Check tailscaled and try again.');
    }
  });

  routes.post('/onboarding/tailscale/https', async (c) => {
    const body = await readJson(c);
    if (body === undefined) return badBody(c);
    const parsed = httpsSchema.safeParse(body);
    if (!parsed.success) return schemaError(c, parsed.error);
    const result = service.enableHttps(
      onboardingToken(c),
      parsed.data.acceptCertificateTransparency,
      parsed.data.hostname,
    );
    if (result.ok) return c.json(result.state);
    if (result.reason === 'invalid_token') {
      return apiError(c, 401, 'invalid_onboarding_token', 'Pair this browser with the server first.');
    }
    if (result.reason === 'notice_required') {
      return apiError(c, 400, 'certificate_notice_required', 'Read and accept the certificate transparency notice first.');
    }
    if (result.reason === 'invalid_hostname') {
      return apiError(c, 400, 'invalid_hostname', 'Use 1–63 lowercase letters, numbers, or interior hyphens.');
    }
    if (result.reason === 'conflict') {
      return apiError(c, 409, 'tailscale_serve_conflict', 'Tailscale Serve already has a different configuration. Pop Agent left it unchanged.');
    }
    if (result.reason === 'approval_required') {
      return c.json({
        required: true,
        phase: 'https' as const,
        tailscaleInstalled: true,
        tailscaleConnected: true,
        approvalUrl: result.approvalUrl,
      }, 202);
    }
    if (result.reason === 'not_ready') {
      return apiError(c, 409, 'tailscale_not_ready', 'Connect this server to Tailscale before enabling HTTPS.');
    }
    return apiError(c, 502, 'tailscale_failed', 'Tailscale HTTPS could not be verified. Check tailscale serve status and try again.');
  });

  return routes;
}

function onboardingToken(c: Context): string {
  return c.req.header(ONBOARDING_TOKEN_HEADER)?.trim() ?? '';
}
