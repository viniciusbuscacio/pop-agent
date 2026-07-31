import { beforeEach, describe, expect, it } from 'vitest';
import type { ModelInfo } from '../ports/agent-bridge.js';
import type { CompletionRequest, ProviderGateway } from '../ports/provider-gateway.js';
import type { SecretsRepo } from '../ports/secrets-repo.js';
import type { SettingsRepo } from '../ports/settings-repo.js';
import { FALLBACK_MODELS } from './openrouter.js';
import { ProviderService } from './provider-service.js';

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

let secrets: MemorySecrets;
let settings: MemorySettings;
let gateway: ScriptedGateway;
let clock: TickingClock;
let envKey: string | undefined;
let engineCatalog: ModelInfo[];
let service: ProviderService;

beforeEach(() => {
  secrets = new MemorySecrets();
  settings = new MemorySettings();
  gateway = new ScriptedGateway();
  clock = new TickingClock();
  envKey = undefined;
  engineCatalog = [{ id: 'engine/model' }];
  service = new ProviderService({
    secrets,
    settings,
    gateway,
    clock,
    envKey: () => envKey,
    engineModels: () => Promise.resolve(engineCatalog),
  });
});

describe('the key', () => {
  it('is not configured until something provides one', () => {
    expect(service.apiKey()).toBeUndefined();
    expect(service.status()).toEqual({ id: 'openrouter', configured: false, source: null });
  });

  it('comes from the environment when nothing is stored', () => {
    envKey = 'sk-env';

    expect(service.apiKey()).toBe('sk-env');
    expect(service.status()).toEqual({ id: 'openrouter', configured: true, source: 'env' });
  });

  it('prefers the stored key over the environment', () => {
    // The stored key is the one the user can see and change from Settings.
    envKey = 'sk-env';
    service.setKey('sk-stored');

    expect(service.apiKey()).toBe('sk-stored');
    expect(service.status()).toEqual({ id: 'openrouter', configured: true, source: 'settings' });
  });

  it('falls back to the environment once the stored key is cleared', () => {
    envKey = 'sk-env';
    service.setKey('sk-stored');

    service.clearKey();

    expect(service.apiKey()).toBe('sk-env');
  });
});

describe('testing the key', () => {
  it('makes one real, tiny completion with the candidate key', async () => {
    const result = await service.test('sk-pasted');

    expect(result).toEqual({ ok: true });
    expect(gateway.completions).toHaveLength(1);
    expect(gateway.completions[0]?.apiKey).toBe('sk-pasted');
    expect(gateway.completions[0]?.maxTokens).toBeLessThanOrEqual(5);
  });

  it('tests the stored key when none is passed', async () => {
    service.setKey('sk-stored');

    await service.test();

    expect(gateway.completions[0]?.apiKey).toBe('sk-stored');
  });

  it('hands back the provider s own words when the key is refused', async () => {
    gateway.failCompleting = 'Invalid credentials';

    expect(await service.test('sk-bad')).toEqual({ ok: false, message: 'Invalid credentials' });
  });

  it('does not bother the provider when there is no key at all', async () => {
    const result = await service.test();

    expect(result.ok).toBe(false);
    expect(gateway.completions).toHaveLength(0);
  });
});

describe('the catalog', () => {
  it('is the engine catalog while there is no key to fetch a live one', async () => {
    expect(await service.models()).toEqual([{ id: 'engine/model' }]);
    expect(gateway.listed).toBe(0);
  });

  it('is fetched live once a key exists, then served from cache for a day', async () => {
    service.setKey('sk');

    expect(await service.models()).toEqual([{ id: 'live/model' }]);
    expect(await service.models()).toEqual([{ id: 'live/model' }]);
    expect(gateway.listed).toBe(1);

    clock.value += 24 * 60 * 60 * 1000 + 1;
    await service.models();
    expect(gateway.listed).toBe(2);
  });

  it('serves the stale cache when the live fetch fails', async () => {
    service.setKey('sk');
    await service.models();

    clock.value += 25 * 60 * 60 * 1000;
    gateway.failListing = true;

    expect(await service.models()).toEqual([{ id: 'live/model' }]);
  });

  it('falls back to the engine catalog when the fetch fails with nothing cached', async () => {
    service.setKey('sk');
    gateway.failListing = true;

    expect(await service.models()).toEqual([{ id: 'engine/model' }]);
  });

  it('answers the pinned row when every other source is empty', async () => {
    engineCatalog = [];

    expect(await service.models()).toEqual(FALLBACK_MODELS);
  });
});
