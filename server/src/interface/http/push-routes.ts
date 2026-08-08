import { Hono } from 'hono';
import { z } from 'zod';
import type { PushService } from '../../application/ports/push-repo.js';
import { badBody, readJson, schemaError } from './body.js';

/**
 * Web Push subscription management (pop-agent.spec §14). The browser fetches the
 * VAPID public key, subscribes with the push service, and hands the result
 * here; unsubscribe removes it. Sending happens elsewhere, when a run finishes.
 */

const subscribeSchema = z
  .object({
    endpoint: z.string().url().max(2000),
    keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(200) }).strict(),
  })
  .strict();

const unsubscribeSchema = z.object({ endpoint: z.string().max(2000) }).strict();

export interface PushRoutesDeps {
  push: PushService;
}

export function createPushRoutes(deps: PushRoutesDeps): Hono {
  const routes = new Hono();

  routes.get('/push/key', (c) => c.json({ publicKey: deps.push.vapidPublicKey() }));

  routes.post('/push/subscribe', async (c) => {
    const body = await readJson(c);
    if (body === undefined) return badBody(c);
    const parsed = subscribeSchema.safeParse(body);
    if (!parsed.success) return schemaError(c, parsed.error);

    deps.push.subscribe({
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
    });
    return c.json({ subscribed: true });
  });

  routes.post('/push/unsubscribe', async (c) => {
    const body = await readJson(c);
    if (body === undefined) return badBody(c);
    const parsed = unsubscribeSchema.safeParse(body);
    if (!parsed.success) return schemaError(c, parsed.error);

    deps.push.unsubscribe(parsed.data.endpoint);
    return c.json({ unsubscribed: true });
  });

  return routes;
}
