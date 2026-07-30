import type { Hono } from 'hono';
import { AuthService } from '../../application/auth/auth-service.js';
import type { Clock } from '../../application/ports/clock.js';
import type { PasswordHasher } from '../../application/ports/password-hasher.js';
import type { SecretsRepo } from '../../application/ports/secrets-repo.js';
import type { SettingsRepo } from '../../application/ports/settings-repo.js';
import { createApp } from './app.js';

/**
 * Test-only wiring: the real app over in-memory adapters and a clock the test
 * moves by hand. It lives beside the routes (rather than inside a single test
 * file) because both the app and the auth suites need the same stack, and
 * because building the app for real is the point -- a mocked router would test
 * the mock.
 */

export const FIXED_NOW = 1_700_000_000_000;

export class MemorySettings implements SettingsRepo {
  private readonly rows = new Map<string, string>();
  get<T>(key: string): T | undefined {
    const raw = this.rows.get(key);
    return raw === undefined ? undefined : (JSON.parse(raw) as T);
  }
  set<T>(key: string, value: T): void {
    this.rows.set(key, JSON.stringify(value));
  }
}

export class MemorySecrets implements SecretsRepo {
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

export class FakeClock implements Clock {
  private value: number;
  constructor(start: number = FIXED_NOW) {
    this.value = start;
  }
  now(): number {
    return this.value;
  }
  advance(ms: number): void {
    this.value += ms;
  }
}

/** argon2 is slow by design; the route tests care about wiring, not hashing. */
export const fastHasher: PasswordHasher = {
  hash: (plaintext) => Promise.resolve(`hashed:${plaintext}`),
  verify: (hash, plaintext) => Promise.resolve(hash === `hashed:${plaintext}`),
};

export interface TestApp {
  app: Hono;
  auth: AuthService;
  clock: FakeClock;
}

export function createTestApp(clock: FakeClock = new FakeClock()): TestApp {
  const auth = new AuthService({
    settings: new MemorySettings(),
    secrets: new MemorySecrets(),
    hasher: fastHasher,
    clock,
  });
  return { app: createApp({ auth, clock }), auth, clock };
}
