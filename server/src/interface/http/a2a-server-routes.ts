import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import type { A2aSettingsService } from '../../application/a2a/a2a-settings.js';
import type { A2aServerProtocol } from '../../application/ports/a2a-server.js';
import { IntegrationError } from '../../domain/integrations/integration.js';
import { apiError } from './errors.js';
import { restClientIp } from './rest-client-ip.js';

function appWithErrors(): Hono {
  const app = new Hono();
  app.onError((error, c) => {
    if (error instanceof IntegrationError) {
      if (error.status === 429) c.header('Retry-After', '60');
      return apiError(c, error.status, error.code, 'A2A access denied: ' + error.code);
    }
    return apiError(c, 400, 'invalid_input', 'The A2A request could not be completed.');
  });
  return app;
}
export function createA2aServerRoutes(settings: A2aSettingsService, protocol: A2aServerProtocol): Hono {
  const app = appWithErrors();
  for (const path of ['/.well-known/agent-card.json', '/a2a/rpc']) {
    app.use(path, async (c, next) => {
      settings.admit((c.req.header('authorization') ?? '').replace(/^Bearer /, ''), restClientIp(c));
      c.header('Cache-Control', 'no-store'); await next();
    });
    app.use(path, bodyLimit({ maxSize: 128 * 1024, onError: c => apiError(c, 413, 'too_large', 'A2A request exceeds 128 KiB.') }));
  }
  const origin = (url: string): string => new URL(url).origin.replace(/^http:/, 'https:');
  app.get('/.well-known/agent-card.json', c => c.json(protocol.card(origin(c.req.url))));
  app.post('/a2a/rpc', async c => {
    const value: unknown = await c.req.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) return apiError(c, 400, 'invalid_input', 'Expected a JSON-RPC request.');
    const secret = (c.req.header('authorization') ?? '').replace(/^Bearer /, '');
    const result = await protocol.handle(value as Record<string, unknown>, origin(c.req.url), c.req.raw.signal,
      () => settings.authorize(secret, restClientIp(c)));
    settings.authorize(secret, restClientIp(c));
    return c.json(result);
  });
  return app;
}
export function createA2aSettingsRoutes(settings: A2aSettingsService, protocol: A2aServerProtocol): Hono {
  const app = appWithErrors();
  app.use('/a2a/server/*', bodyLimit({ maxSize: 16 * 1024 }));
  app.get('/a2a/settings', c => c.json(settings.get()));
  app.patch('/a2a/settings', async c => {
    const patch = z.object({ serverEnabled: z.boolean().optional(), clientEnabled: z.boolean().optional() }).strict().parse(await c.req.json());
    return c.json(settings.configure({ ...(patch.serverEnabled === undefined ? {} : { serverEnabled: patch.serverEnabled }), ...(patch.clientEnabled === undefined ? {} : { clientEnabled: patch.clientEnabled }) }));
  });
  app.get('/a2a/server/health', c => c.json({ ok: settings.get().serverEnabled }));
  app.get('/a2a/server/card', c => { c.header('Cache-Control', 'no-store'); return c.json(protocol.card(new URL(c.req.url).origin.replace(/^http:/, 'https:'))); });
  app.get('/a2a/server/key', c => { c.header('Cache-Control', 'no-store'); return c.json({ secret: settings.ensureKey() }); });
  app.post('/a2a/server/key', c => { c.header('Cache-Control', 'no-store'); return c.json({ secret: settings.rotateKey() }); });
  app.get('/a2a/server/allowed-ips', c => c.json({ entries: settings.allowedIps() }));
  app.put('/a2a/server/allowed-ips', async c => {
    const { entries } = z.object({ entries: z.array(z.string().max(100)).min(1).max(100) }).strict().parse(await c.req.json());
    return c.json({ entries: settings.setAllowedIps(entries) });
  });
  app.get('/a2a/client/allowed-ips', c => c.json({ entries: settings.outboundIps() }));
  app.put('/a2a/client/allowed-ips', async c => {
    const { entries } = z.object({ entries: z.array(z.string().max(100)).max(100) }).strict().parse(await c.req.json());
    return c.json({ entries: settings.setOutboundIps(entries) });
  });
  return app;
}
