import { beforeEach, describe, expect, it } from 'vitest';
import type { ModelInfo } from '../ports/agent-bridge.js';
import type { CompletionRequest, ProviderGateway } from '../ports/provider-gateway.js';
import type { SecretsRepo } from '../ports/secrets-repo.js';
import type { SettingsRepo } from '../ports/settings-repo.js';
import { FALLBACK_MODELS } from './openrouter.js';
import { ProviderCooldown } from './provider-cooldown.js';
import { ProviderService, type ProviderStatus } from './provider-service.js';

class MemorySettings implements SettingsRepo {
  private readonly rows = new Map<string, string>();
  get<T>(key: string): T | undefined {
    const raw = this.rows.get(key);
    return raw === undefined ? undefined : (JSON.parse(raw) as T);
  }
  set<T>(key: string, value: T): void {
    this.rows.set(key, JSON.stringify(value));
  }
}

class MemorySecrets implements SecretsRepo {
  private readonly rows = new Map<string, string>();
  get(key: string): string | undefined {
    return this.rows.get(key);
  }
  set(key: string, value: string): void {
    this.rows.set(key, value);
  }
  delete(key: string): void {
    this.rows.delete(key);
  }
}

/** A gateway whose behaviour the test scripts, call by call. */
class ScriptedGateway implements ProviderGateway {
  catalog: ModelInfo[] = [{ id: 'live/model' }];
  failListing = false;
  failCompleting: string | undefined;
  listed = 0;
  completions: CompletionRequest[] = [];

  listModels(): Promise<ModelInfo[]> {
    this.listed += 1;
    if (this.failListing) return Promise.reject(new Error('offline'));
    return Promise.resolve(this.catalog);
  }

  complete(request: CompletionRequest): Promise<string> {
    this.completions.push(request);
    if (this.failCompleting !== undefined) {
      return Promise.reject(new Error(this.failCompleting));
    }
    return Promise.resolve('ok');
  }
}

class TickingClock {
  value = 1_700_000_000_000;
  now(): number {
    return this.value;
  }
}

const OPENROUTER = 'openrouter';

function status(overrides: Partial<ProviderStatus> = {}): ProviderStatus {
  return {
    id: OPENROUTER,
    name: 'OpenRouter',
    authType: 'api-key',
    configured: false,
    source: null,
    defaultModel: 'moonshotai/kimi-k3',
    allowCustomModel: true,
    order: 1,
    enabled: true,
    ...overrides,
  };
}

let secrets: MemorySecrets;
let settings: MemorySettings;
let gateway: ScriptedGateway;
let clock: TickingClock;
let envKey: string | undefined;
let engineCatalog: ModelInfo[];
let oauthAuthed: Set<string>;
let checkAuthCalls: string[];
let cooldown: ProviderCooldown;
let defaults: { provider: string; model: string };
let service: ProviderService;
/** Seeded ids come first; then a deterministic unique fallback. */
let nextCustomIds: string[];
let customIdFallback: number;

beforeEach(() => {
  secrets = new MemorySecrets();
  settings = new MemorySettings();
  gateway = new ScriptedGateway();
  clock = new TickingClock();
  envKey = undefined;
  engineCatalog = [{ id: 'engine/model' }];
  oauthAuthed = new Set();
  checkAuthCalls = [];
  cooldown = new ProviderCooldown({ clock });
  defaults = { provider: OPENROUTER, model: 'moonshotai/kimi-k3' };
  nextCustomIds = [];
  customIdFallback = 0;
  service = new ProviderService({
    secrets,
    settings,
    gateways: { [OPENROUTER]: gateway },
    customGateway: () => gateway,
    customIdSource: () =>
      nextCustomIds.shift() ?? (customIdFallback++).toString(16).padStart(10, '0'),
    clock,
    envKey: () => envKey,
    engineModels: () => Promise.resolve(engineCatalog),
    engineHasAuth: (providerId) => oauthAuthed.has(providerId),
    engineCheckAuth: (providerId) => {
      checkAuthCalls.push(providerId);
      return Promise.resolve(
        oauthAuthed.has(providerId) ? { ok: true } : { ok: false, message: 'Not signed in.' },
      );
    },
    engineLogout: (providerId) => {
      oauthAuthed.delete(providerId);
      return Promise.resolve();
    },
    cooldown,
    defaults: () => defaults,
    setDefaultProvider: (provider, model) => {
      defaults = { provider, model };
    },
  });
});

describe('the key', () => {
  it('is not configured until something provides one', () => {
    expect(service.apiKey(OPENROUTER)).toBeUndefined();
    expect(service.status(OPENROUTER)).toEqual(status());
  });

  it('comes from the environment when nothing is stored', () => {
    envKey = 'sk-env';

    expect(service.apiKey(OPENROUTER)).toBe('sk-env');
    expect(service.status(OPENROUTER)).toEqual(status({ configured: true, source: 'env' }));
  });

  it('prefers the stored key over the environment', () => {
    // The stored key is the one the user can see and change from Settings.
    envKey = 'sk-env';
    service.setKey(OPENROUTER, 'sk-stored');

    expect(service.apiKey(OPENROUTER)).toBe('sk-stored');
    expect(service.status(OPENROUTER)).toEqual(status({ configured: true, source: 'settings' }));
  });

  it('falls back to the environment once the stored key is cleared', () => {
    envKey = 'sk-env';
    service.setKey(OPENROUTER, 'sk-stored');

    service.clearKey(OPENROUTER);

    expect(service.apiKey(OPENROUTER)).toBe('sk-env');
  });

  it('only seeds OpenRouter from the environment', () => {
    envKey = 'sk-env';

    expect(service.apiKey('anthropic')).toBeUndefined();
  });
});

describe('testing the key', () => {
  it('makes one real, tiny completion with the candidate key', async () => {
    const result = await service.test(OPENROUTER, 'sk-pasted');

    expect(result).toEqual({ ok: true, latencyMs: 0 });
    expect(gateway.completions).toHaveLength(1);
    expect(gateway.completions[0]?.apiKey).toBe('sk-pasted');
    expect(gateway.completions[0]?.maxTokens).toBeLessThanOrEqual(5);
  });

  it('tests the stored key when none is passed', async () => {
    service.setKey(OPENROUTER, 'sk-stored');

    await service.test(OPENROUTER);

    expect(gateway.completions[0]?.apiKey).toBe('sk-stored');
  });

  it('hands back the provider s own words when the key is refused', async () => {
    gateway.failCompleting = 'Invalid credentials';

    expect(await service.test(OPENROUTER, 'sk-bad')).toEqual({
      ok: false,
      message: 'Invalid credentials',
      latencyMs: 0,
    });
  });

  it('does not bother the provider when there is no key at all', async () => {
    const result = await service.test(OPENROUTER);

    expect(result.ok).toBe(false);
    expect(gateway.completions).toHaveLength(0);
  });
});

describe('the catalog', () => {
  it('is the engine catalog while there is no key to fetch a live one', async () => {
    expect(await service.models(OPENROUTER)).toEqual({
      models: [{ id: 'engine/model' }],
      source: 'engine',
    });
    expect(gateway.listed).toBe(0);
  });

  it('is fetched live once a key exists, then served from cache for a day', async () => {
    service.setKey(OPENROUTER, 'sk');

    expect(await service.models(OPENROUTER)).toEqual({
      models: [{ id: 'live/model' }],
      source: 'live',
    });
    expect(await service.models(OPENROUTER)).toEqual({
      models: [{ id: 'live/model' }],
      source: 'cache',
    });
    expect(gateway.listed).toBe(1);

    clock.value += 24 * 60 * 60 * 1000 + 1;
    expect((await service.models(OPENROUTER)).source).toBe('live');
    expect(gateway.listed).toBe(2);
  });

  it('serves the stale cache when the live fetch fails', async () => {
    service.setKey(OPENROUTER, 'sk');
    await service.models(OPENROUTER);

    clock.value += 25 * 60 * 60 * 1000;
    gateway.failListing = true;

    expect(await service.models(OPENROUTER)).toEqual({
      models: [{ id: 'live/model' }],
      source: 'cache',
    });
  });

  it('falls back to the engine catalog when the fetch fails with nothing cached', async () => {
    service.setKey(OPENROUTER, 'sk');
    gateway.failListing = true;

    expect(await service.models(OPENROUTER)).toEqual({
      models: [{ id: 'engine/model' }],
      source: 'engine',
    });
  });

  it('answers the pinned row when every other source is empty', async () => {
    engineCatalog = [];

    expect(await service.models(OPENROUTER)).toEqual({ models: FALLBACK_MODELS, source: 'static' });
  });
});

describe('resolving the pair', () => {
  it('honours a usable chat override', () => {
    service.setKey('anthropic', 'sk-ant');

    expect(service.resolve({ provider: 'anthropic', model: 'claude-sonnet-4-5' })).toEqual({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
    });
  });

  it('degrades a broken override to the configured default, never an error', () => {
    service.setKey(OPENROUTER, 'sk');

    expect(service.resolve({ provider: 'anthropic', model: 'claude-sonnet-4-5' })).toEqual({
      providerId: OPENROUTER,
      modelId: 'moonshotai/kimi-k3',
    });
  });

  it('elects the next configured provider when the default loses its key', () => {
    service.setKey('anthropic', 'sk-ant');

    expect(service.resolve()).toEqual({ providerId: 'anthropic', modelId: 'claude-sonnet-4-5' });
  });

  it('answers the default pair even with nothing configured, so the error points at Settings', () => {
    expect(service.resolve()).toEqual({ providerId: OPENROUTER, modelId: 'moonshotai/kimi-k3' });
  });

  it('treats a signed-in subscription as usable, no key involved', () => {
    oauthAuthed.add('openai-codex');

    expect(service.resolve({ provider: 'openai-codex', model: '' })).toEqual({
      providerId: 'openai-codex',
      modelId: 'gpt-5.5',
    });
    expect(service.resolve()).toEqual({ providerId: 'openai-codex', modelId: 'gpt-5.5' });
  });
});

describe('subscription (oauth) providers', () => {
  const CODEX = 'openai-codex';

  it('reports the engine credential as the whole configuration', () => {
    expect(service.status(CODEX)).toEqual({
      id: CODEX,
      name: 'OpenAI — ChatGPT subscription',
      authType: 'oauth',
      configured: false,
      source: null,
      defaultModel: 'gpt-5.5',
      allowCustomModel: false,
      order: 4,
      enabled: true,
    });

    oauthAuthed.add(CODEX);

    expect(service.status(CODEX)).toEqual(
      expect.objectContaining({ configured: true, source: 'oauth' }),
    );
    // Still no key anywhere.
    expect(service.apiKey(CODEX)).toBeUndefined();
  });

  it('tests through the engine check, never the HTTP gateways', async () => {
    oauthAuthed.add(CODEX);

    const result = await service.test(CODEX);

    expect(result).toEqual({ ok: true, latencyMs: 0 });
    expect(checkAuthCalls).toEqual([CODEX]);
    expect(gateway.completions).toHaveLength(0);
  });

  it('hands back the check s words when the credential is gone', async () => {
    expect(await service.test(CODEX)).toEqual({
      ok: false,
      message: 'Not signed in.',
      latencyMs: 0,
    });
  });

  it('answers the engine catalog keyless, never touching a gateway', async () => {
    expect(await service.models(CODEX)).toEqual({
      models: [{ id: 'engine/model' }],
      source: 'engine',
    });
    expect(gateway.listed).toBe(0);
  });

  it('falls back to the pinned static list when the engine has nothing', async () => {
    engineCatalog = [];

    const { models, source } = await service.models(CODEX);

    expect(source).toBe('static');
    expect(models.map((model) => model.id)).toContain('gpt-5.5');
  });

  it('disconnect drops the engine credential', async () => {
    oauthAuthed.add(CODEX);

    await service.disconnect(CODEX);

    expect(service.status(CODEX)?.configured).toBe(false);
  });
});

/**
 * The priority list (popy.spec §15, fase 2). The list the user edits IS the
 * failover order and its head IS the global default -- aw's lesson, ported:
 * two levers for one decision let the numbered list say one thing while new
 * chats did another.
 */
describe('the priority list', () => {
  it('gives every provider a position, in definition order, before anyone edits it', () => {
    const ids = service.statuses().map((entry) => entry.id);
    expect(service.order()).toEqual(ids);
    expect(service.statuses().map((entry) => entry.order)).toEqual(
      ids.map((_id, index) => index + 1),
    );
  });

  it('drives the chain and elects its head as the global default', () => {
    secrets.set('provider.openai.apiKey', 'sk-openai');
    secrets.set('provider.openrouter.apiKey', 'sk-openrouter');

    service.setOrder(['openai', OPENROUTER]);

    expect(service.order().slice(0, 2)).toEqual(['openai', OPENROUTER]);
    expect(defaults.provider).toBe('openai');
    expect(service.resolveChain().map((pair) => pair.providerId)).toEqual([
      'openai',
      OPENROUTER,
    ]);
  });

  it('elects the first head that can actually answer, not merely the first', () => {
    // Only the second one has a key: an unusable head would point the whole
    // workspace at a provider that cannot serve a single run.
    secrets.set('provider.anthropic.apiKey', 'sk-anthropic');

    service.setOrder(['openai', 'anthropic', OPENROUTER]);

    expect(defaults.provider).toBe('anthropic');
  });

  it('keeps a provider left out of a saved list, at the tail', () => {
    service.setOrder(['anthropic']);

    const order = service.order();
    expect(order[0]).toBe('anthropic');
    expect(order).toContain(OPENROUTER);
    expect(order.length).toBe(service.statuses().length);
  });

  it('refuses ids nothing answers to instead of storing them', () => {
    service.setOrder(['ghost', 'anthropic']);

    expect(service.order()).not.toContain('ghost');
    expect(service.order()[0]).toBe('anthropic');
  });

  it('takes a switched-off provider out of the chain, even when a chat names it', () => {
    secrets.set('provider.openai.apiKey', 'sk-openai');
    secrets.set('provider.openrouter.apiKey', 'sk-openrouter');

    service.setEnabled('openai', false);

    expect(service.status('openai')?.enabled).toBe(false);
    const chain = service.resolveChain({ provider: 'openai' }).map((pair) => pair.providerId);
    expect(chain).not.toContain('openai');
    expect(chain[0]).toBe(OPENROUTER);
  });

  it('hands the default over when the head is switched off', () => {
    secrets.set('provider.openrouter.apiKey', 'sk-openrouter');
    secrets.set('provider.anthropic.apiKey', 'sk-anthropic');
    service.setOrder([OPENROUTER, 'anthropic']);
    expect(defaults.provider).toBe(OPENROUTER);

    service.setEnabled(OPENROUTER, false);

    expect(defaults.provider).toBe('anthropic');
  });

  it('forgets a deleted custom instance instead of holding its position', () => {
    const instance = service.createCustom({ name: 'Ollama', baseURL: 'http://x/v1', defaultModel: 'llama4' });
    service.setOrder([instance.id, OPENROUTER]);
    expect(service.order()[0]).toBe(instance.id);

    service.deleteCustom(instance.id);

    expect(service.order()).not.toContain(instance.id);
  });
});

describe('the failover chain (popy.spec §15, fase 2)', () => {
  it('lists every usable provider once, default first', () => {
    service.setKey(OPENROUTER, 'sk-or');
    service.setKey('anthropic', 'sk-ant');
    oauthAuthed.add('openai-codex');

    expect(service.resolveChain()).toEqual([
      { providerId: OPENROUTER, modelId: 'moonshotai/kimi-k3' },
      { providerId: 'anthropic', modelId: 'claude-sonnet-4-5' },
      { providerId: 'openai-codex', modelId: 'gpt-5.5' },
    ]);
  });

  it('puts a usable chat override at the head, without duplicating its provider', () => {
    service.setKey(OPENROUTER, 'sk-or');
    service.setKey('anthropic', 'sk-ant');

    const chain = service.resolveChain({ provider: 'anthropic', model: 'claude-haiku-4-5' });

    expect(chain).toEqual([
      { providerId: 'anthropic', modelId: 'claude-haiku-4-5' },
      { providerId: OPENROUTER, modelId: 'moonshotai/kimi-k3' },
    ]);
  });

  it('drops an unusable override instead of trying it', () => {
    service.setKey(OPENROUTER, 'sk-or');

    expect(service.resolveChain({ provider: 'anthropic', model: 'x' })).toEqual([
      { providerId: OPENROUTER, modelId: 'moonshotai/kimi-k3' },
    ]);
  });

  it('skips a penalized provider while another can answer', () => {
    service.setKey(OPENROUTER, 'sk-or');
    service.setKey('anthropic', 'sk-ant');
    cooldown.penalize(OPENROUTER);

    expect(service.resolveChain()).toEqual([
      { providerId: 'anthropic', modelId: 'claude-sonnet-4-5' },
    ]);
  });

  it('is advisory: with every provider penalized the full chain returns', () => {
    service.setKey(OPENROUTER, 'sk-or');
    service.setKey('anthropic', 'sk-ant');
    cooldown.penalize(OPENROUTER);
    cooldown.penalize('anthropic');

    expect(service.resolveChain().map((ref) => ref.providerId)).toEqual([
      OPENROUTER,
      'anthropic',
    ]);
  });

  it('saving a key forgives the provider s penalty', () => {
    service.setKey(OPENROUTER, 'sk-or');
    service.setKey('anthropic', 'sk-ant');
    cooldown.penalize(OPENROUTER);

    service.setKey(OPENROUTER, 'sk-or-fresh');

    expect(service.resolveChain()[0]?.providerId).toBe(OPENROUTER);
  });

  it('degrades to the default pair when nothing is usable, so the error points at Settings', () => {
    expect(service.resolveChain()).toEqual([
      { providerId: OPENROUTER, modelId: 'moonshotai/kimi-k3' },
    ]);
  });
});

describe('custom provider instances (popy.spec §15)', () => {
  it('creates instances with fresh custom- ids, retrying a collision', () => {
    nextCustomIds = ['aaaaaaaaaa', 'aaaaaaaaaa', 'bbbbbbbbbb'];

    const first = service.createCustom({ name: 'Ollama' });
    const second = service.createCustom({ name: 'vLLM' });

    expect(first.id).toBe('custom-aaaaaaaaaa');
    // The colliding roll was discarded and a new one drawn.
    expect(second.id).toBe('custom-bbbbbbbbbb');
    expect(service.listCustom().map((instance) => instance.name)).toEqual(['Ollama', 'vLLM']);
  });

  it('normalizes the pasted endpoint down to the base URL', () => {
    const instance = service.createCustom({
      name: 'Local',
      baseURL: 'http://localhost:11434/v1/chat/completions/',
    });

    expect(instance.baseURL).toBe('http://localhost:11434/v1');

    const updated = service.updateCustom(instance.id, { baseURL: 'http://box:8000/v1///' });
    expect(updated?.baseURL).toBe('http://box:8000/v1');
  });

  it('shows up in statuses after the builtins, as an editable custom card', () => {
    const instance = service.createCustom({ name: 'Ollama', baseURL: 'http://localhost:11434/v1', defaultModel: 'llama4' });

    const all = service.statuses();
    expect(all[all.length - 1]).toEqual({
      id: instance.id,
      name: 'Ollama',
      authType: 'api-key',
      configured: false,
      source: null,
      defaultModel: 'llama4',
      allowCustomModel: true,
      order: all.length,
      enabled: true,
      baseURL: 'http://localhost:11434/v1',
      custom: true,
    });
  });

  it('keeps each instance s key sealed under its own id', () => {
    const first = service.createCustom({ name: 'One' });
    const second = service.createCustom({ name: 'Two' });

    service.setKey(first.id, 'sk-one');
    service.setKey(second.id, 'sk-two');

    expect(service.apiKey(first.id)).toBe('sk-one');
    expect(service.apiKey(second.id)).toBe('sk-two');
    expect(secrets.get(`provider.${first.id}.apiKey`)).toBe('sk-one');

    service.deleteCustom(first.id);

    expect(service.apiKey(first.id)).toBeUndefined();
    expect(service.apiKey(second.id)).toBe('sk-two');
  });

  it('joins the failover chain after the builtins, in registry order', () => {
    service.setKey(OPENROUTER, 'sk-or');
    const a = service.createCustom({ name: 'A', baseURL: 'http://a/v1', defaultModel: 'model-a' });
    const b = service.createCustom({ name: 'B', baseURL: 'http://b/v1', defaultModel: 'model-b' });
    service.setKey(a.id, 'sk-a');
    service.setKey(b.id, 'sk-b');

    expect(service.resolveChain().map((ref) => ref.providerId)).toEqual([
      OPENROUTER,
      a.id,
      b.id,
    ]);
    expect(service.resolveChain()[1]?.modelId).toBe('model-a');
  });

  it('deleting an instance removes its status and degrades its overrides', () => {
    service.setKey(OPENROUTER, 'sk-or');
    const instance = service.createCustom({ name: 'Gone', baseURL: 'http://x/v1', defaultModel: 'm' });
    service.setKey(instance.id, 'sk-x');

    expect(service.deleteCustom(instance.id)).toBe(true);
    expect(service.deleteCustom(instance.id)).toBe(false);

    expect(service.status(instance.id)).toBeUndefined();
    expect(service.resolve({ provider: instance.id, model: 'm' })).toEqual({
      providerId: OPENROUTER,
      modelId: 'moonshotai/kimi-k3',
    });
  });

  it('tests through the instance s own endpoint gateway', async () => {
    const instance = service.createCustom({ name: 'Local', baseURL: 'http://localhost:11434/v1', defaultModel: 'llama4' });
    service.setKey(instance.id, 'sk-local');

    const result = await service.test(instance.id);

    expect(result.ok).toBe(true);
    expect(gateway.completions[0]?.apiKey).toBe('sk-local');
    expect(gateway.completions[0]?.model).toBe('llama4');
  });

  it('refuses to test an instance that has no endpoint yet', async () => {
    const instance = service.createCustom({ name: 'Empty' });
    service.setKey(instance.id, 'sk');

    expect((await service.test(instance.id)).message).toBe('Set the endpoint URL before testing.');
  });
});

describe('migrating the single-slot custom (popy.spec §15)', () => {
  it('turns the legacy config and key into one working instance', () => {
    settings.set('provider.custom.config', {
      baseURL: 'http://localhost:11434/v1',
      defaultModel: 'llama4',
    });
    secrets.set('provider.custom.apiKey', 'sk-legacy');

    service.migrateLegacyCustom();

    const [instance] = service.listCustom();
    expect(instance).toMatchObject({
      name: 'Custom (OpenAI-compatible)',
      baseURL: 'http://localhost:11434/v1',
      defaultModel: 'llama4',
    });
    // The key moved under the new id; the legacy entries are gone.
    expect(service.apiKey(instance?.id ?? '')).toBe('sk-legacy');
    expect(secrets.get('provider.custom.apiKey')).toBeUndefined();
    expect(settings.get('provider.custom.config')).toEqual({ baseURL: '', defaultModel: '' });
  });

  it('lets a chat override still saying "custom" reach the migrated instance', () => {
    settings.set('provider.custom.config', {
      baseURL: 'http://localhost:11434/v1',
      defaultModel: 'llama4',
    });
    secrets.set('provider.custom.apiKey', 'sk-legacy');
    service.migrateLegacyCustom();
    const [instance] = service.listCustom();

    expect(service.resolve({ provider: 'custom', model: '' })).toEqual({
      providerId: instance?.id,
      modelId: 'llama4',
    });
  });

  it('is a no-op with nothing legacy, and does not run twice', () => {
    service.migrateLegacyCustom();
    expect(service.listCustom()).toEqual([]);

    settings.set('provider.custom.config', { baseURL: 'http://x/v1', defaultModel: 'm' });
    service.migrateLegacyCustom();
    service.migrateLegacyCustom();

    expect(service.listCustom()).toHaveLength(1);
  });
});
