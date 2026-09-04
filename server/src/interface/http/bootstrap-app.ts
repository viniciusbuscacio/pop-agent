import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { ServerOnboardingService } from '../../application/onboarding/server-onboarding-service.js';
import { apiError } from './errors.js';
import { createOnboardingRoutes } from './onboarding-routes.js';
import { createStaticSite } from './static-site.js';

const MAX_BOOTSTRAP_BODY_BYTES = 16 * 1024;

/** Temporary private-LAN surface: no password, login, product, download, or WebSocket routes. */
export function createBootstrapApp(deps: {
  onboarding: ServerOnboardingService;
  webDist: string;
}): Hono {
  const app = new Hono();
  app.use('/v1/*', bodyLimit({
    maxSize: MAX_BOOTSTRAP_BODY_BYTES,
    onError: (c) => apiError(c, 413, 'too_large', 'This request body is too large.'),
  }));
  app.get('/healthz', (c) => c.json({ ok: true }));
  app.get('/v1/health', (c) => c.json({ server: 'ok' as const, provider: 'ok' as const, db: 'ok' as const }));
  app.get('/v1/auth/state', (c) => c.json({ setupDone: false, setupMode: 'network' as const }));
  app.route('/v1', createOnboardingRoutes(deps.onboarding));
  app.use(createStaticSite(deps.webDist));
  app.notFound((c) =>
    c.json({ error: { code: 'not_found', message: 'Route not found', status: 404 } }, 404),
  );
  return app;
}
