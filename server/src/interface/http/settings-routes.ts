import { Hono } from 'hono';
import { z } from 'zod';
import type { AboutResponse, SettingsDTO } from '@pop-agent/shared';
import type { AppSettings, SettingsService } from '../../application/settings/settings-service.js';
import { badBody, readJson, schemaError } from './body.js';
import { apiError } from './errors.js';

/**
 * Settings and About (docs/specs/Spec-Pop-General.md §13). Both need a session; the middleware has
 * already run by the time these handlers see a request.
 *
 * PUT remains the full-document compatibility API. PATCH is what independent
 * Settings controls use: each request validates and atomically merges only the
 * fields it owns, so two open sections cannot restore each other's stale data.
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
    // Accepted and ignored for one compatibility window so an already-open
    // pre-beta PWA can save another setting after these unsafe controls vanish.
    autoActivatePreparedUpdates: z.boolean().optional(),
    autoRestartIdleMinutes: z.number().int().min(1).max(1440).optional(),
  })
  .strict();

const settingsPatchSchema = settingsSchema.partial().extend({ expectedInstructions: z.string().max(MAX_INSTRUCTIONS).optional() }).refine((patch) => Object.keys(patch).length > 0);

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
      language: parsed.data.language,
      defaultProvider: parsed.data.defaultProvider,
      defaultModel: parsed.data.defaultModel,
      customInstructions: parsed.data.customInstructions,
      voiceModel: parsed.data.voiceModel,
      voiceCleanup: parsed.data.voiceCleanup,
      voiceCleanupModel: parsed.data.voiceCleanupModel,
      autoSkillsEnabled: parsed.data.autoSkillsEnabled,
      piUpdatePolicy: parsed.data.piUpdatePolicy ?? deps.settings.read().piUpdatePolicy,
    };
    return c.json(toDto(deps.settings.write(next)));
  });

  routes.patch('/settings', async (c) => {
    const body = await readJson(c);
    if (body === undefined) return badBody(c);

    const parsed = settingsPatchSchema.safeParse(body);
    if (!parsed.success) return schemaError(c, parsed.error);

    if (parsed.data.expectedInstructions !== undefined && deps.settings.read().customInstructions !== parsed.data.expectedInstructions) {
      return apiError(c, 409, 'edit_conflict', 'Instructions changed on the server. Review the latest version before saving.');
    }

    // Zod represents optional properties as `T | undefined`; JSON cannot carry
    // undefined, so normalize that inference before the exact optional app type.
    const patch = Object.fromEntries(
      Object.entries(parsed.data).filter(
        ([key, value]) => value !== undefined
          && key !== 'expectedInstructions'
          && key !== 'autoActivatePreparedUpdates'
          && key !== 'autoRestartIdleMinutes',
      ),
    ) as Partial<AppSettings>;
    if (Object.keys(patch).length === 0) return c.json(toDto(deps.settings.read()));
    return c.json(toDto(deps.settings.update(patch)));
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
  };
}
