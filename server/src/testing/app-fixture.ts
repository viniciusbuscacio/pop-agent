import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import type { Hono } from 'hono';
import { AuthService } from '../application/auth/auth-service.js';
import { ChatService } from '../application/chat/chat-service.js';
import { RunService } from '../application/chat/run-service.js';
import type { Clock } from '../application/ports/clock.js';
import type { PasswordHasher } from '../application/ports/password-hasher.js';
import type { SecretsRepo } from '../application/ports/secrets-repo.js';
import type { SettingsRepo } from '../application/ports/settings-repo.js';
import { SettingsService } from '../application/settings/settings-service.js';
import { FakeAgentBridge } from '../infrastructure/agent/fake-bridge.js';
import { migrate } from '../infrastructure/db/migrate.js';
import { SqliteChatRepo } from '../infrastructure/db/sqlite-chat-repo.js';
import { createApp } from '../interface/http/app.js';
import { SseHub } from '../interface/http/sse-hub.js';

/**
 * Test-only wiring: the real app, assembled the way main.ts assembles it, over
 * an in-memory database and a clock the test moves by hand.
 *
 * It lives in its own layer because it reaches across all of them on purpose.
 * The boundary test lets `testing` import anything and lets nothing import
 * `testing`, so this convenience cannot leak into the running app.
 *
 * Settings and secrets are in-memory maps (they are key-value stores and a
 * fake is honest), but chats use the real SQLite adapter: half of what the run
 * orchestration does is decide what gets stored, and a fake repository would
 * quietly agree with whatever the code did.
 */

export const FIXED_NOW = 1_700_000_000_000;

/** The real build output: the gate builds before it tests, so it is there. */
export const WEB_DIST = fileURLToPath(new URL('../../../web/dist', import.meta.url));

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
    // Stands still until a test moves it: anything that expires or counts down
    // is asserted to the second, and a clock that ticks when you read it would
    // make those assertions guesswork.
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
  chats: ChatService;
  runs: RunService;
  hub: SseHub;
  clock: FakeClock;
}

export function createTestApp(clock: FakeClock = new FakeClock()): TestApp {
  const settingsRepo = new MemorySettings();
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  const chatRepo = new SqliteChatRepo(db);

  const auth = new AuthService({
    settings: settingsRepo,
    secrets: new MemorySecrets(),
    hasher: fastHasher,
    clock,
  });

  // Fast-forwarded scripts: the route tests assert on shape and order, and
  // nobody should wait thirty real seconds for the slow one.
  const bridge = new FakeAgentBridge(200);
  const hub = new SseHub();
  const chats = new ChatService({ chats: chatRepo, clock });
  const runs = new RunService({ chats: chatRepo, bridge, sink: hub, clock });

  const app = createApp({
    auth,
    settings: new SettingsService(settingsRepo),
    chats,
    runs,
    bridge,
    hub,
    clock,
    versions: { popyVersion: '0.0.0-test', nodeVersion: process.version, piVersion: '0.0.0-test' },
    webDist: WEB_DIST,
  });

  return { app, auth, chats, runs, hub, clock };
}
