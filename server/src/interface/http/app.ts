import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { AboutResponse, StreamEvent } from '@popy/shared';
import type { AuthService } from '../../application/auth/auth-service.js';
import type { Clock } from '../../application/ports/clock.js';
import type { SettingsService } from '../../application/settings/settings-service.js';
import { authMiddleware } from './auth-middleware.js';
import { createAuthRoutes } from './auth-routes.js';
import { createSettingsRoutes } from './settings-routes.js';
import { HOME_PAGE } from './home-page.js';

export interface AppDeps {
  auth: AuthService;
  settings: SettingsService;
  clock: Clock;
  /**
   * Read once at boot: versions cannot change while the process runs, so a
   * port with a live reader would buy nothing.
   */
  versions: AboutResponse;
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  // Placeholder landing page until the React web/ frontend lands.
  app.get('/', (c) => c.html(HOME_PAGE));

  app.get('/healthz', (c) => c.json({ ok: true }));

  // Guard everything under /v1 except the handful of public auth endpoints.
  app.use('/v1/*', authMiddleware(deps.auth));
  app.route('/v1', createAuthRoutes(deps));
  app.route('/v1', createSettingsRoutes(deps));

  // Skeleton hello-world: streams a fake run over the real SSE channel so
  // the transport can be exercised end to end (curl, tests, smoke) before
  // the pi bridge lands. Replaced by real run events in the next step.
  app.get('/v1/events', (c) =>
    streamSSE(c, async (stream) => {
      const chatId = 'chat-000000000000';
      const runId = 'run-hello';
      const words = ['Hello', 'from', 'Popy.', 'Streaming', 'works.'];
      for (const [i, word] of words.entries()) {
        const event: StreamEvent = {
          kind: 'delta',
          chatId,
          runId,
          text: i === 0 ? word : ` ${word}`,
        };
        await stream.writeSSE({ data: JSON.stringify(event) });
        await stream.sleep(150);
      }
      const done: StreamEvent = {
        kind: 'done',
        chatId,
        runId,
        messageId: 'msg-0000000000000000',
      };
      await stream.writeSSE({ data: JSON.stringify(done) });
    }),
  );

  app.notFound((c) =>
    c.json(
      { error: { code: 'not_found', message: 'Route not found', status: 404 } },
      404,
    ),
  );

  return app;
}
