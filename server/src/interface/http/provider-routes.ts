import { Hono } from 'hono';
import { z } from 'zod';
import type { ProvidersResponse, TestProviderResponse } from '@popy/shared';
import type { ProviderService } from '../../application/providers/provider-service.js';
import { badBody, readJson, schemaError } from './body.js';
import { apiError } from './errors.js';

/**
 * Provider configuration (popy.spec §15). One provider today, but the wire
 * speaks plural from the start so the multi-provider phase adds rows, not
 * routes.
 *
 * The key is write-only end to end: it goes in through PUT, it can be tested
 * and deleted, and no response anywhere carries it back out.
 */

const keySchema = z.object({ apiKey: z.string().min(1).max(500) }).strict();
const testSchema = z.object({ apiKey: z.string().min(1).max(500).optional() }).strict();

export interface ProviderRoutesDeps {
  providers: ProviderService;
}

export function createProviderRoutes(deps: ProviderRoutesDeps): Hono {
  const routes = new Hono();

  routes.get('/providers', (c) => {
    const status = deps.providers.status();
    const response: ProvidersResponse = { providers: [status] };
    return c.json(response);
  });

  routes.put('/providers/openrouter/key', async (c) => {
    const body = await readJson(c);
    if (body === undefined) return badBody(c);
    const parsed = keySchema.safeParse(body);
    if (!parsed.success) return schemaError(c, parsed.error);

    deps.providers.setKey(parsed.data.apiKey);
    return c.json({ providers: [deps.providers.status()] } satisfies ProvidersResponse);
  });

  routes.delete('/providers/openrouter/key', (c) => {
    // Only the stored key can be cleared; one set by the environment is the
    // server operator's decision, not the UI's.
    if (deps.providers.status().source !== 'settings') {
      return apiError(c, 404, 'not_found', 'There is no stored key to remove.');
    }
    deps.providers.clearKey();
    return c.json({ providers: [deps.providers.status()] } satisfies ProvidersResponse);
  });

  routes.post('/providers/openrouter/test', async (c) => {
    // No body means "test the stored key"; a pasted one tests the candidate.
    const raw = (await readJson(c)) ?? {};
    const parsed = testSchema.safeParse(raw);
    if (!parsed.success) return schemaError(c, parsed.error);

    const result = await deps.providers.test(parsed.data.apiKey);
    const response: TestProviderResponse = {
      ok: result.ok,
      ...(result.message === undefined ? {} : { message: result.message }),
    };
    return c.json(response);
  });

  return routes;
}
