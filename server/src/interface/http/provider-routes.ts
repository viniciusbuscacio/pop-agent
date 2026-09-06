import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type {
  CreateCustomProviderResponse,
  OAuthStartResponse,
  OAuthStateResponse,
  ProviderCreditsResponse,
  ProviderStatusDTO,
  ProviderSubscriptionUsageResponse,
  ProvidersResponse,
  TestProviderResponse,
  TranscribeResponse,
} from '@pop-agent/shared';
import {
  OAuthCooldownError,
  type OAuthFlowService,
} from '../../application/providers/oauth-flow-service.js';
import {
  MAX_CUSTOM_PROVIDERS,
  type ProviderService,
} from '../../application/providers/provider-service.js';
import { PROVIDER_DEFINITIONS } from '../../application/providers/provider-definitions.js';
import { TranscriberError, type Transcriber } from '../../application/ports/transcriber.js';
import type { VoiceCleanup } from '../../application/voice/voice-cleanup.js';
import { badBody, readJson, schemaError } from './body.js';
import { apiError } from './errors.js';

/**
 * Provider configuration (docs/specs/Spec-Pop-General.md §15). The routes speak plural and are
 * driven by the declarative provider list: adding a provider adds a row of
 * data, never a route.
 *
 * The key is write-only end to end: it goes in through PUT, it can be tested
 * and deleted, and no response anywhere carries it back out.
 */

const keySchema = z.object({ apiKey: z.string().min(1).max(500) }).strict();
const testSchema = z.object({ apiKey: z.string().min(1).max(500).optional() }).strict();
const defaultModelSchema = z.object({ model: z.string().max(200) }).strict();
/** Empty puts the provider back to following its chat model (docs/specs/Spec-Pop-General.md §15). */
const serviceModelSchema = z.object({ model: z.string().max(200) }).strict();
/** The whole priority list at once: partial edits would need a merge rule. */
const orderSchema = z
  .object({
    ids: z
      .array(z.string().min(1).max(60))
      .max(MAX_CUSTOM_PROVIDERS + PROVIDER_DEFINITIONS.length),
  })
  .strict();
const enabledSchema = z.object({ enabled: z.boolean() }).strict();
const createCustomSchema = z.object({ name: z.string().min(1).max(100).optional() }).strict();
const patchCustomSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    baseURL: z.string().url().max(500).optional(),
    defaultModel: z.string().max(200).optional(),
  })
  .strict();
const providerConfigurationSchema = z
  .object({
    defaultModel: z.string().max(200),
    serviceModel: z.string().max(200),
    priority: z.number().int().min(1).max(MAX_CUSTOM_PROVIDERS + PROVIDER_DEFINITIONS.length),
    apiKey: z.string().min(1).max(500).optional(),
    name: z.string().min(1).max(100).optional(),
    baseURL: z.string().url().max(500).optional(),
  })
  .strict();
const createConfiguredCustomSchema = providerConfigurationSchema
  .extend({
    name: z.string().min(1).max(100),
    baseURL: z.string().url().max(500),
    apiKey: z.string().min(1).max(500),
  })
  .strict();
/** A prompt answer during OAuth sign-in: a code or an option id, never a key. */
const oauthInputSchema = z.object({ value: z.string().max(2000) }).strict();

/** ~25 MB of audio, aw's cap, as base64. */
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const MAX_AUDIO_DATA_URI = 35_000_000;
const transcribeSchema = z
  .object({ dataUri: z.string().startsWith('data:audio/').max(MAX_AUDIO_DATA_URI) })
  .strict();

export interface ProviderRoutesDeps {
  providers: ProviderService;
  /** The single-active OAuth sign-in flow (docs/specs/Spec-Pop-General.md §15, fase 1.5). */
  oauthFlows: OAuthFlowService;
  transcriber: Transcriber;
  voiceCleanup: VoiceCleanup;
  /**
   * Balance lookup for providers that publish one (LOTE 6). Undefined in the
   * deps or undefined from the call both mean "no balance to show" -- the
   * endpoint answers 404 and the client hides the row.
   */
  credits?: (providerId: string) => Promise<{ remaining: number; used: number } | undefined>;
  /** Subscription allowance stripped of account identity and OAuth material. */
  subscriptionUsage?: (
    providerId: string,
  ) => Promise<ProviderSubscriptionUsageResponse | undefined>;
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

  routes.get('/providers/:id/subscription-usage', async (c) => {
    const id = c.req.param('id');
    const status = deps.providers.status(id);
    if (status === undefined) return providerNotFound(c, id);
    if (status.authType !== 'oauth') {
      return apiError(c, 404, 'not_found', 'This provider has no subscription allowance.');
    }
    try {
      const usage = await deps.subscriptionUsage?.(id);
      if (usage === undefined) {
        return apiError(c, 404, 'not_found', 'This provider does not publish usage right now.');
      }
      return c.json(usage satisfies ProviderSubscriptionUsageResponse);
    } catch {
      return apiError(c, 502, 'provider_unavailable', 'The subscription usage could not be read.');
    }
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

  // The priority list (docs/specs/Spec-Pop-General.md §15, fase 2): #1 is the global default and
  // the rest is the failover order. Sent whole, like every other list here.
  routes.put('/providers/order', async (c) => {
    const body = await readJson(c);
    if (body === undefined) return badBody(c);
    const parsed = orderSchema.safeParse(body);
    if (!parsed.success) return schemaError(c, parsed.error);
    deps.providers.setOrder(parsed.data.ids);
    return c.json({ providers: deps.providers.statuses().map(toStatusDto) } satisfies ProvidersResponse);
  });

  routes.put('/providers/:id/enabled', async (c) => {
    const id = c.req.param('id');
    if (deps.providers.status(id) === undefined) return providerNotFound(c, id);
    const body = await readJson(c);
    if (body === undefined) return badBody(c);
    const parsed = enabledSchema.safeParse(body);
    if (!parsed.success) return schemaError(c, parsed.error);
    deps.providers.setEnabled(id, parsed.data.enabled);
    return c.json({ providers: deps.providers.statuses().map(toStatusDto) } satisfies ProvidersResponse);
  });

  // The provider's default model: the pair's provider half already has a
  // home (Settings), this is the per-provider half (docs/specs/Spec-Pop-General.md §15).
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

  // The provider's Service Model: what Pop Agent uses for its own background work
  // on this provider (docs/specs/Spec-Pop-General.md §15, corrected 07/08). Beside the credential
  // rather than in General, because a model id only means something inside one
  // provider's catalog.
  routes.put('/providers/:id/service-model', async (c) => {
    const id = c.req.param('id');
    if (deps.providers.status(id) === undefined) return providerNotFound(c, id);
    const body = await readJson(c);
    if (body === undefined) return badBody(c);
    const parsed = serviceModelSchema.safeParse(body);
    if (!parsed.success) return schemaError(c, parsed.error);

    deps.providers.setServiceModel(id, parsed.data.model);
    return c.json({ providers: deps.providers.statuses().map(toStatusDto) } satisfies ProvidersResponse);
  });

  // One card, one request. All fields are validated before the first write,
  // so a dropped later browser request cannot leave half the form applied.
  routes.put('/providers/:id/configuration', async (c) => {
    const id = c.req.param('id');
    const status = deps.providers.status(id);
    if (status === undefined) return providerNotFound(c, id);
    const body = await readJson(c);
    if (body === undefined) return badBody(c);
    const parsed = providerConfigurationSchema.safeParse(body);
    if (!parsed.success) return schemaError(c, parsed.error);
    if (status.custom !== true && (parsed.data.name !== undefined || parsed.data.baseURL !== undefined)) {
      return apiError(c, 400, 'invalid_field', 'Built-in providers do not have custom identity fields.');
    }
    if (status.authType === 'oauth' && deps.providers.status(id)?.configured !== true) {
      return apiError(c, 409, 'provider_login_required', 'Sign in to this subscription provider before saving its configuration.');
    }
    if (status.authType === 'api-key' && !status.configured && parsed.data.apiKey === undefined) {
      return apiError(c, 400, 'missing_field', 'An API key is required to add this provider.');
    }

    if (status.custom === true) {
      deps.providers.updateCustom(id, {
        ...(parsed.data.name === undefined ? {} : { name: parsed.data.name }),
        ...(parsed.data.baseURL === undefined ? {} : { baseURL: parsed.data.baseURL }),
        defaultModel: parsed.data.defaultModel,
      });
    } else {
      deps.providers.setDefaultModel(id, parsed.data.defaultModel);
    }
    deps.providers.setServiceModel(id, parsed.data.serviceModel);
    if (parsed.data.apiKey !== undefined) deps.providers.setKey(id, parsed.data.apiKey);
    moveProviderToPriority(deps.providers, id, parsed.data.priority);
    return c.json({ providers: deps.providers.statuses().map(toStatusDto) } satisfies ProvidersResponse);
  });

  // Unlimited custom providers (docs/specs/Spec-Pop-General.md §15): each instance is pure data --
  // a name, an endpoint, a model -- created first (the id anchors everything),
  // edited in place, deleted with its key. Never a secret in any of these.
  routes.post('/providers/custom', async (c) => {
    const raw = (await readJson(c)) ?? {};
    const parsed = createCustomSchema.safeParse(raw);
    if (!parsed.success) return schemaError(c, parsed.error);

    const instance = deps.providers.createCustom(
      parsed.data.name === undefined ? {} : { name: parsed.data.name },
    );
    if (instance === undefined) {
      return apiError(
        c,
        409,
        'too_many_providers',
        `A Pop Agent install holds at most ${String(MAX_CUSTOM_PROVIDERS)} custom providers.`,
      );
    }
    return c.json({
      id: instance.id,
      providers: deps.providers.statuses().map(toStatusDto),
    } satisfies CreateCustomProviderResponse);
  });

  routes.post('/providers/custom/configuration', async (c) => {
    const body = await readJson(c);
    if (body === undefined) return badBody(c);
    const parsed = createConfiguredCustomSchema.safeParse(body);
    if (!parsed.success) return schemaError(c, parsed.error);

    const instance = deps.providers.createCustom({
      name: parsed.data.name,
      baseURL: parsed.data.baseURL,
      defaultModel: parsed.data.defaultModel,
    });
    if (instance === undefined) {
      return apiError(
        c,
        409,
        'too_many_providers',
        `A Pop Agent install holds at most ${String(MAX_CUSTOM_PROVIDERS)} custom providers.`,
      );
    }
    // These are synchronous repository writes and cannot reject after the
    // validated registry row is created.
    deps.providers.setServiceModel(instance.id, parsed.data.serviceModel);
    deps.providers.setKey(instance.id, parsed.data.apiKey);
    moveProviderToPriority(deps.providers, instance.id, parsed.data.priority);
    return c.json({
      id: instance.id,
      providers: deps.providers.statuses().map(toStatusDto),
    } satisfies CreateCustomProviderResponse);
  });

  routes.patch('/providers/custom/:id', async (c) => {
    const id = c.req.param('id');
    const body = await readJson(c);
    if (body === undefined) return badBody(c);
    const parsed = patchCustomSchema.safeParse(body);
    if (!parsed.success) return schemaError(c, parsed.error);

    const patch = {
      ...(parsed.data.name === undefined ? {} : { name: parsed.data.name }),
      ...(parsed.data.baseURL === undefined ? {} : { baseURL: parsed.data.baseURL }),
      ...(parsed.data.defaultModel === undefined ? {} : { defaultModel: parsed.data.defaultModel }),
    };
    if (deps.providers.updateCustom(id, patch) === undefined) {
      return providerNotFound(c, id);
    }
    return c.json({ providers: deps.providers.statuses().map(toStatusDto) } satisfies ProvidersResponse);
  });

  routes.delete('/providers/custom/:id', (c) => {
    const id = c.req.param('id');
    if (!deps.providers.deleteCustom(id)) return providerNotFound(c, id);
    return c.json({ providers: deps.providers.statuses().map(toStatusDto) } satisfies ProvidersResponse);
  });

  // Subscription sign-in (docs/specs/Spec-Pop-General.md §15, fase 1.5). The flow lives on the
  // server; these four routes are the browser's whole view of it: start it,
  // poll its transcript, answer its one question, stop it. Token material
  // never crosses this wire in either direction.
  routes.post('/providers/:id/oauth/start', (c) => {
    const id = c.req.param('id');
    const status = deps.providers.status(id);
    if (status === undefined) return providerNotFound(c, id);
    if (status.authType !== 'oauth') {
      return apiError(c, 404, 'not_found', `"${id}" does not sign in with OAuth.`);
    }
    try {
      return c.json(deps.oauthFlows.start(id) satisfies OAuthStartResponse);
    } catch (error) {
      if (error instanceof OAuthCooldownError) {
        c.header('Retry-After', String(error.retryAfterSeconds));
        return apiError(c, 429, 'rate_limited', error.message);
      }
      throw error;
    }
  });

  routes.get('/providers/:id/oauth/state', (c) => {
    const id = c.req.param('id');
    if (deps.providers.status(id) === undefined) return providerNotFound(c, id);
    const state = deps.oauthFlows.state();
    if (state === undefined || state.providerId !== id) {
      return apiError(c, 404, 'not_found', 'No sign-in is running for this provider.');
    }
    return c.json(state satisfies OAuthStateResponse);
  });

  routes.post('/providers/:id/oauth/input', async (c) => {
    const id = c.req.param('id');
    if (deps.providers.status(id) === undefined) return providerNotFound(c, id);
    const body = await readJson(c);
    if (body === undefined) return badBody(c);
    const parsed = oauthInputSchema.safeParse(body);
    if (!parsed.success) return schemaError(c, parsed.error);

    const state = deps.oauthFlows.state();
    if (state === undefined || state.providerId !== id || !deps.oauthFlows.submit(parsed.data.value)) {
      return apiError(c, 404, 'not_found', 'The sign-in is not waiting for an answer.');
    }
    return c.json({ ok: true });
  });

  routes.post('/providers/:id/oauth/cancel', (c) => {
    const id = c.req.param('id');
    if (deps.providers.status(id) === undefined) return providerNotFound(c, id);
    const state = deps.oauthFlows.state();
    if (state !== undefined && state.providerId === id) deps.oauthFlows.cancel();
    return c.json({ ok: true });
  });

  // Disconnect: drops the stored subscription credential, engine-side.
  routes.post('/providers/:id/oauth/logout', async (c) => {
    const id = c.req.param('id');
    const status = deps.providers.status(id);
    if (status === undefined) return providerNotFound(c, id);
    if (status.authType !== 'oauth') {
      return apiError(c, 404, 'not_found', `"${id}" does not sign in with OAuth.`);
    }
    await deps.providers.disconnect(id);
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
    if (Buffer.byteLength(match[2], 'base64') > MAX_AUDIO_BYTES) {
      return apiError(c, 413, 'too_large', 'Audio notes must be 25 MB or less.');
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

/** Move among usable cards, then preserve every remaining provider at the tail. */
function moveProviderToPriority(providers: ProviderService, providerId: string, priority: number): void {
  const statuses = providers.statuses().sort((left, right) => left.order - right.order);
  const live = statuses
    .filter((entry) => entry.configured || entry.id === providerId)
    .map((entry) => entry.id);
  const without = live.filter((id) => id !== providerId);
  const index = Math.min(Math.max(priority - 1, 0), without.length);
  const ordered = [...without.slice(0, index), providerId, ...without.slice(index)];
  providers.setOrder([
    ...ordered,
    ...statuses.filter((entry) => !ordered.includes(entry.id)).map((entry) => entry.id),
  ]);
}

function providerNotFound(c: Context, id: string): Response {
  return apiError(c, 404, 'not_found', `Unknown provider "${id}".`);
}

function toStatusDto(status: import('../../application/providers/provider-service.js').ProviderStatus): ProviderStatusDTO {
  return {
    id: status.id,
    name: status.name,
    authType: status.authType,
    configured: status.configured,
    source: status.source,
    defaultModel: status.defaultModel,
    serviceModel: status.serviceModel,
    allowCustomModel: status.allowCustomModel,
    order: status.order,
    enabled: status.enabled,
    ...(status.baseURL === undefined ? {} : { baseURL: status.baseURL }),
    ...(status.custom === undefined ? {} : { custom: status.custom }),
    ...(status.authErrorAt === undefined ? {} : { authErrorAt: status.authErrorAt }),
  };
}
