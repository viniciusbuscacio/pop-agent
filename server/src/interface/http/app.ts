import { Hono } from 'hono';
import type { AboutResponse } from '@popy/shared';
import type { AuthService } from '../../application/auth/auth-service.js';
import type { ChatService } from '../../application/chat/chat-service.js';
import type { RunService } from '../../application/chat/run-service.js';
import type { Clock } from '../../application/ports/clock.js';
import type { ProviderService } from '../../application/providers/provider-service.js';
import type { Transcriber } from '../../application/ports/transcriber.js';
import type { SettingsService } from '../../application/settings/settings-service.js';
import { authMiddleware } from './auth-middleware.js';
import { createAuthRoutes } from './auth-routes.js';
import { createChatRoutes } from './chat-routes.js';
import { EventTickets } from './event-tickets.js';
import { createProviderRoutes } from './provider-routes.js';
import { createSettingsRoutes } from './settings-routes.js';
import { SseHub } from './sse-hub.js';
import { createStaticSite } from './static-site.js';

export interface AppDeps {
  auth: AuthService;
  settings: SettingsService;
  chats: ChatService;
  runs: RunService;
  providers: ProviderService;
  transcriber: Transcriber;
  /** The sink the run service emits into; the hub is its adapter. */
  hub: SseHub;
  clock: Clock;
  /**
   * Read once at boot: versions cannot change while the process runs, so a
   * port with a live reader would buy nothing.
   */
  versions: AboutResponse;
  /** Directory holding the built frontend (web/dist). */
  webDist: string;
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  app.get('/healthz', (c) => c.json({ ok: true }));

  // Guard everything under /v1 except the handful of public auth endpoints.
  app.use('/v1/*', authMiddleware(deps.auth));
  app.route('/v1', createAuthRoutes(deps));
  app.route('/v1', createSettingsRoutes(deps));
  app.route('/v1', createProviderRoutes(deps));
  app.route('/v1', createChatRoutes({ ...deps, tickets: new EventTickets(deps.clock) }));

  // Last: anything that is not an API route is the frontend or a 404.
  app.use(createStaticSite(deps.webDist));

  app.notFound((c) =>
    c.json({ error: { code: 'not_found', message: 'Route not found', status: 404 } }, 404),
  );

  return app;
}
