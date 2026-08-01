import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type {
  ProviderCreditsResponse,
  ProviderStatusDTO,
  ProvidersResponse,
  TestProviderResponse,
  TranscribeResponse,
} from '@popy/shared';
import type { ProviderService } from '../../application/providers/provider-service.js';
import { TranscriberError, type Transcriber } from '../../application/ports/transcriber.js';
import type { VoiceCleanup } from '../../application/voice/voice-cleanup.js';
import { badBody, readJson, schemaError } from './body.js';
import { apiError } from './errors.js';

/**
 * Provider configuration (popy.spec §15). The routes speak plural and are
 * driven by the declarative provider list: adding a provider adds a row of
 * data, never a route.
 *
 * The key is write-only end to end: it goes in through PUT, it can be tested
 * and deleted, and no response anywhere carries it back out.
 */

const keySchema = z.object({ apiKey: z.string().min(1).max(500) }).strict();
const testSchema = z.object({ apiKey: z.string().min(1).max(500).optional() }).strict();
const defaultModelSchema = z.object({ model: z.string().max(200) }).strict();
const customConfigSchema = z
  .object({ baseURL: z.string().url().max(500), defaultModel: z.string().min(1).max(200) })
  .strict();

/** ~25 MB of audio, aw's cap, as base64. */
const transcribeSchema = z
  .object({ dataUri: z.string().startsWith('data:audio/').max(34_000_000) })
  .strict();

export interface ProviderRoutesDeps {
  providers: ProviderService;
  transcriber: Transcriber;
  voiceCleanup: VoiceCleanup;
  /**
   * Balance lookup for providers that publish one (LOTE 6). Undefined in the
   * deps or undefined from the call both mean "no balance to show" -- the
   * endpoint answers 404 and the client hides the row.
   */
  credits?: (providerId: string) => Promise<{ remaining: number; used: number } | undefined>;
}

export function createProviderRoutes(deps: ProviderRoutesDeps): Hono {
  const routes = new Hono();

  routes.get('/providers', (c) => {
    const response: ProvidersResponse = {
      providers: deps.providers.statuses().map(toStatusDto),
    };
    return c.json(response);
  });

  routes.get('/providers/:id/credits', async (c) => {
    const id = c.req.param('id');
    if (deps.providers.status(id) === undefined) return providerNotFound(c, id);
    const credits = (await deps.credits?.(id)) ?? undefined;
    if (credits === undefined) {
      return apiError(c, 404, 'not_found', 'This provider does not publish a balance right now.');
    }
    return c.json(credits satisfies ProviderCreditsResponse);
  });

  routes.put('/providers/:id/key', async (c) => {
    const id = c.req.param('id');
    if (deps.providers.status(id) === undefined) return providerNotFound(c, id);
    const body = await readJson(c);
    if (body === undefined) return badBody(c);
    const parsed = keySchema.safeParse(body);
    if (!parsed.success) return schemaError(c, parsed.error);

    deps.providers.setKey(id, parsed.data.apiKey);
    return c.json({ providers: deps.providers.statuses().map(toStatusDto) } satisfies ProvidersResponse);
  });

  routes.delete('/providers/:id/key', (c) => {
    const id = c.req.param('id');
    const status = deps.providers.status(id);
    if (status === undefined) return providerNotFound(c, id);
    // Only the stored key can be cleared; one set by the environment is the
    // server operator's decision, not the UI's.
    if (status.source !== 'settings') {
      return apiError(c, 404, 'not_found', 'There is no stored key to remove.');
    }
    deps.providers.clearKey(id);
    return c.json({ providers: deps.providers.statuses().map(toStatusDto) } satisfies ProvidersResponse);
  });

  routes.post('/providers/:id/test', async (c) => {
    const id = c.req.param('id');
    if (deps.providers.status(id) === undefined) return providerNotFound(c, id);
    // No body means "test the stored key"; a pasted one tests the candidate.
    const raw = (await readJson(c)) ?? {};
    const parsed = testSchema.safeParse(raw);
    if (!parsed.success) return schemaError(c, parsed.error);

    const result = await deps.providers.test(id, parsed.data.apiKey);
    const response: TestProviderResponse = {
      ok: result.ok,
      ...(result.message === undefined ? {} : { message: result.message }),
      ...(result.latencyMs === undefined ? {} : { latencyMs: result.latencyMs }),
    };
    return c.json(response);
  });

  // The provider's default model: the pair's provider half already has a
  // home (Settings), this is the per-provider half (popy.spec §15).
  routes.put('/providers/:id/default-model', async (c) => {
    const id = c.req.param('id');
    if (deps.providers.status(id) === undefined) return providerNotFound(c, id);
    const body = await readJson(c);
    if (body === undefined) return badBody(c);
    const parsed = defaultModelSchema.safeParse(body);
    if (!parsed.success) return schemaError(c, parsed.error);

    deps.providers.setDefaultModel(id, parsed.data.model);
    return c.json({ providers: deps.providers.statuses().map(toStatusDto) } satisfies ProvidersResponse);
  });

  // The custom provider is pure data: an endpoint and a model, never a secret.
  routes.put('/providers/custom/config', async (c) => {
    const body = await readJson(c);
    if (body === undefined) return badBody(c);
    const parsed = customConfigSchema.safeParse(body);
    if (!parsed.success) return schemaError(c, parsed.error);

    deps.providers.setCustomConfig(parsed.data);
    return c.json({ providers: deps.providers.statuses().map(toStatusDto) } satisfies ProvidersResponse);
  });

  routes.post('/transcribe', async (c) => {
    const body = await readJson(c);
    if (body === undefined) return badBody(c);
    const parsed = transcribeSchema.safeParse(body);
    if (!parsed.success) return schemaError(c, parsed.error);

    const match = /^data:audio\/([\w+-]+)(?:;[^,]*)?;base64,(.+)$/.exec(parsed.data.dataUri);
    if (match?.[1] === undefined || match[2] === undefined) {
      return apiError(c, 400, 'invalid_field', 'The recording did not arrive as audio.');
    }

    // Local whisper does the work: failures come back as words, never a 500.
    // A cheap LLM pass then cleans the raw transcript, best-effort (§14).
    try {
      const raw = await deps.transcriber.transcribe({
        audioBase64: match[2],
        format: match[1],
      });
      if (raw.length === 0) {
        return c.json({ ok: false, message: 'Nothing was heard.' } satisfies TranscribeResponse);
      }
      const text = await deps.voiceCleanup.clean(raw);
      return c.json({ ok: true, text } satisfies TranscribeResponse);
    } catch (error) {
      const message =
        error instanceof TranscriberError ? error.message : 'Transcription failed.';
      return c.json({ ok: false, message } satisfies TranscribeResponse);
    }
  });

  return routes;
}

function providerNotFound(c: Context, id: string): Response {
  return apiError(c, 404, 'not_found', `Unknown provider "${id}".`);
}

function toStatusDto(status: import('../../application/providers/provider-service.js').ProviderStatus): ProviderStatusDTO {
  return {
    id: status.id,
    name: status.name,
    configured: status.configured,
    source: status.source,
    defaultModel: status.defaultModel,
    allowCustomModel: status.allowCustomModel,
    ...(status.baseURL === undefined ? {} : { baseURL: status.baseURL }),
  };
}
