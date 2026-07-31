import { Hono } from 'hono';
import { z } from 'zod';
import type { SettingsService } from '../../application/settings/settings-service.js';
import type { VoiceModelStore } from '../../application/ports/voice-models.js';
import { apiError } from './errors.js';

/**
 * Voice model management (popy.spec §14): Settings → Voice lists the whisper
 * models, which are installed, and the one in use; selecting one downloads it
 * if needed (SHA verified) and makes it the default. The `.env` override still
 * wins for an operator who pins a path.
 */

const nameSchema = z.string().regex(/^[a-z0-9.-]{1,60}$/);

export interface VoiceRoutesDeps {
  voiceModels: VoiceModelStore;
  settings: SettingsService;
}

export function createVoiceRoutes(deps: VoiceRoutesDeps): Hono {
  const routes = new Hono();

  routes.get('/voice/models', async (c) =>
    c.json({ models: await deps.voiceModels.status(), selected: deps.settings.read().voiceModel }),
  );

  routes.post('/voice/models/:name', async (c) => {
    const parsed = nameSchema.safeParse(c.req.param('name'));
    if (!parsed.success) return apiError(c, 400, 'invalid_field', 'Unknown model name.');

    try {
      // Download (and verify) if missing, then make it the default.
      await deps.voiceModels.ensure(parsed.data);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The model could not be installed.';
      return apiError(c, 502, 'operation_error', message);
    }

    const current = deps.settings.read();
    deps.settings.write({ ...current, voiceModel: parsed.data });
    return c.json({ selected: parsed.data });
  });

  return routes;
}
