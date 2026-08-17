import { Hono } from 'hono';
import { z } from 'zod';
import type { AboutResponse, SettingsDTO } from '@pop-agent/shared';
import type { AppSettings, SettingsService } from '../../application/settings/settings-service.js';
import { badBody, readJson, schemaError } from './body.js';

/**
 * Settings and About (docs/specs/Spec-Pop-General.md §13). Both need a session; the middleware has
 * already run by the time these handlers see a request.
 *
 * PUT replaces the whole document rather than merging: with `.strict()` on the
 * schema, a client sending a field Pop Agent does not know gets told so, instead of
 * having it quietly dropped and believing it was saved.
 */

/** Room for instructions, not for essays: the cap from the Phase 3 plan. */
const MAX_INSTRUCTIONS = 4_000;

const settingsSchema = z
  .object({
    language: z.literal('en'),
    defaultProvider: z.string().min(1).max(60),
    defaultModel: z.string().min(1).max(200),
    customInstructions: z.string().max(MAX_INSTRUCTIONS),
    voiceModel: z.string().min(1).max(60),
    voiceCleanup: z.boolean(),
    voiceCleanupModel: z.string().max(200),
    autoSkillsEnabled: z.boolean(),
    // Optional only on input so a stale PWA can still save another setting
    // after the server gains this field. GET always returns the complete DTO.
    piUpdatePolicy: z.enum(['keep-current', 'recommended', 'latest']).optional(),
    autoActivatePreparedUpdates: z.boolean(),
    autoRestartIdleMinutes: z.number().int().min(1).max(1440),
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

    const next: AppSettings = {
      ...parsed.data,
      piUpdatePolicy: parsed.data.piUpdatePolicy ?? deps.settings.read().piUpdatePolicy,
    };
    return c.json(toDto(deps.settings.write(next)));
  });

  routes.get('/about', (c) => c.json(deps.versions));

  return routes;
}

/** Explicit mapping: the application type and the wire type evolve separately. */
function toDto(settings: AppSettings): SettingsDTO {
  return {
    language: settings.language,
    defaultProvider: settings.defaultProvider,
    defaultModel: settings.defaultModel,
    customInstructions: settings.customInstructions,
    voiceModel: settings.voiceModel,
    voiceCleanup: settings.voiceCleanup,
    voiceCleanupModel: settings.voiceCleanupModel,
    autoSkillsEnabled: settings.autoSkillsEnabled,
    piUpdatePolicy: settings.piUpdatePolicy,
    autoActivatePreparedUpdates: settings.autoActivatePreparedUpdates,
    autoRestartIdleMinutes: settings.autoRestartIdleMinutes,
  };
}
