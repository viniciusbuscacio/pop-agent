import { Hono } from 'hono';
import { z } from 'zod';
import type { AboutResponse, SettingsDTO } from '@popy/shared';
import type { AppSettings, SettingsService } from '../../application/settings/settings-service.js';
import { badBody, readJson, schemaError } from './body.js';

/**
 * Settings and About (popy.spec §13). Both need a session; the middleware has
 * already run by the time these handlers see a request.
 *
 * PUT replaces the whole document rather than merging: with `.strict()` on the
 * schema, a client sending a field Popy does not know gets told so, instead of
 * having it quietly dropped and believing it was saved.
 */

/** Room for instructions, not for essays: the cap from the Phase 3 plan. */
const MAX_INSTRUCTIONS = 4_000;

const settingsSchema = z
  .object({
    language: z.literal('en'),
    defaultModel: z.string().min(1).max(200),
    serviceModel: z.string().min(1).max(200),
    customInstructions: z.string().max(MAX_INSTRUCTIONS),
    voiceModel: z.string().min(1).max(60),
    voiceCleanup: z.boolean(),
    voiceCleanupModel: z.string().max(200),
  })
  .strict();

export interface SettingsRoutesDeps {
  settings: SettingsService;
  versions: AboutResponse;
}

export function createSettingsRoutes(deps: SettingsRoutesDeps): Hono {
  const routes = new Hono();

  routes.get('/settings', (c) => c.json(toDto(deps.settings.read())));

  routes.put('/settings', async (c) => {
    const body = await readJson(c);
    if (body === undefined) return badBody(c);

    const parsed = settingsSchema.safeParse(body);
    if (!parsed.success) return schemaError(c, parsed.error);

    return c.json(toDto(deps.settings.write(parsed.data)));
  });

  routes.get('/about', (c) => c.json(deps.versions));

  return routes;
}

/** Explicit mapping: the application type and the wire type evolve separately. */
function toDto(settings: AppSettings): SettingsDTO {
  return {
    language: settings.language,
    defaultModel: settings.defaultModel,
    serviceModel: settings.serviceModel,
    customInstructions: settings.customInstructions,
    voiceModel: settings.voiceModel,
    voiceCleanup: settings.voiceCleanup,
    voiceCleanupModel: settings.voiceCleanupModel,
  };
}
