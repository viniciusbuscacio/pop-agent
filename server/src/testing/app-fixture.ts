import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import type { Hono } from 'hono';
import { AuthService } from '../application/auth/auth-service.js';
import { ChatService } from '../application/chat/chat-service.js';
import { RunService } from '../application/chat/run-service.js';
import { TitleService } from '../application/chat/title-service.js';
import type { Clock } from '../application/ports/clock.js';
import type { PasswordHasher } from '../application/ports/password-hasher.js';
import type { CompletionRequest, ProviderGateway } from '../application/ports/provider-gateway.js';
import type { SecretsRepo } from '../application/ports/secrets-repo.js';
import type { SettingsRepo } from '../application/ports/settings-repo.js';
import { ProviderService } from '../application/providers/provider-service.js';
import { SettingsService } from '../application/settings/settings-service.js';
import { FakeAgentBridge } from '../infrastructure/agent/fake-bridge.js';
import { FsArtifactStore } from '../infrastructure/artifacts/artifact-store.js';
import { ArtifactService } from '../application/artifacts/artifact-service.js';
import { migrate } from '../infrastructure/db/migrate.js';
import { SqliteChatRepo } from '../infrastructure/db/sqlite-chat-repo.js';
import { SqliteArtifactRepo } from '../infrastructure/db/sqlite-artifact-repo.js';
import { SqliteFolderRepo } from '../infrastructure/db/sqlite-folder-repo.js';
import { SqliteUsageRepo } from '../infrastructure/db/sqlite-usage-repo.js';
import { SqliteUserMemoryRepo } from '../infrastructure/db/sqlite-user-memory-repo.js';
import { SkillsVault } from '../infrastructure/skills/skills-vault.js';
import { TarBackupService } from '../infrastructure/backup/tar-backup-service.js';
import { WebAuthnService } from '../infrastructure/auth/webauthn-service.js';
import { SqliteWebAuthnRepo } from '../infrastructure/db/sqlite-webauthn-repo.js';
import { SqliteLlmRunsRepo } from '../infrastructure/db/sqlite-llm-runs-repo.js';
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

/** A gateway that must never be reached: the tests run offline. */
export class RefusingGateway implements ProviderGateway {
  listModels(): Promise<never> {
    return Promise.reject(new Error('the tests must not touch the network'));
  }
  complete(_request: CompletionRequest): Promise<never> {
    return Promise.reject(new Error('the tests must not touch the network'));
  }
}

/** A transcriber the tests script: fixed words, or a failure with words. */
export class FakeTranscriber {
  transcript = 'what the voice note said';
  failure: Error | undefined;
  jobs: { audioBase64: string; format: string }[] = [];

  transcribe(job: { audioBase64: string; format: string }): Promise<string> {
    this.jobs.push(job);
    if (this.failure !== undefined) return Promise.reject(this.failure);
    return Promise.resolve(this.transcript);
  }
}

export interface TestApp {
  app: Hono;
  auth: AuthService;
  chats: ChatService;
  artifacts: ArtifactService;
  runs: RunService;
  providers: ProviderService;
  secrets: MemorySecrets;
  hub: SseHub;
  clock: FakeClock;
}

export interface TestAppOptions {
  /** Swap in a scripted gateway to test the provider routes. */
  gateway?: ProviderGateway;
  /** Stands in for OPENROUTER_API_KEY in the environment. */
  envKey?: string;
  /** Swap in a scripted transcriber to test the voice route. */
  transcriber?: FakeTranscriber;
}

export function createTestApp(
  clock: FakeClock = new FakeClock(),
  options: TestAppOptions = {},
): TestApp {
  const settingsRepo = new MemorySettings();
  const secrets = new MemorySecrets();
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  const chatRepo = new SqliteChatRepo(db);

  const auth = new AuthService({
    settings: settingsRepo,
    secrets,
    hasher: fastHasher,
    clock,
  });

  // Fast-forwarded scripts: the route tests assert on shape and order, and
  // nobody should wait thirty real seconds for the slow one.
  const bridge = new FakeAgentBridge(200);
  const hub = new SseHub();
  const chats = new ChatService({ chats: chatRepo, clock });

  const gateway = options.gateway ?? new RefusingGateway();
  const providers = new ProviderService({
    secrets,
    settings: settingsRepo,
    gateway,
    clock,
    envKey: () => options.envKey,
    engineModels: () => bridge.listModels(),
  });

  const settings = new SettingsService(settingsRepo);
  const artifacts = new ArtifactService({
    repo: new SqliteArtifactRepo(db),
    folders: new SqliteFolderRepo(db),
    store: new FsArtifactStore(mkdtempSync(join(tmpdir(), 'popy-test-artifacts-'))),
    secretKey: Buffer.from('test-artifact-signing-key-000000'),
    clock,
  });
  // Wired exactly the way main.ts wires it: with no key configured the title
  // job is a silent no-op, which is what the fake-bridge tests need.
  const runs = new RunService({
    chats: chatRepo,
    bridge,
    sink: hub,
    clock,
    llmRuns: new SqliteLlmRunsRepo(db),
    titles: new TitleService({
      chats: chatRepo,
      gateway,
      apiKey: () => providers.apiKey(),
      serviceModel: () => settings.read().serviceModel,
      sink: hub,
    }),
  });

  const app = createApp({
    auth,
    settings,
    chats,
    artifacts,
    runs,
    providers,
    transcriber: options.transcriber ?? new FakeTranscriber(),
    voiceCleanup: { clean: (text: string) => Promise.resolve(text) } as never,
    voiceModels: {
      status: () => Promise.resolve([{ name: 'medium', approxMb: 1530, installed: true }]),
      ensure: () => Promise.resolve('/models/ggml-medium.bin'),
    },
    userMemory: new SqliteUserMemoryRepo(db),
    skills: new SkillsVault(mkdtempSync(join(tmpdir(), 'popy-test-skills-'))),
    usage: new SqliteUsageRepo(db),
    push: {
      vapidPublicKey: () => 'test-vapid-key',
      subscribe: () => undefined,
      unsubscribe: () => undefined,
      send: () => Promise.resolve(),
    },
    webauthn: new WebAuthnService({ repo: new SqliteWebAuthnRepo(db), now: () => clock.now() }),
    updates: {
      status: () =>
        Promise.resolve({
          pi: { current: '0.83.0', latest: '0.83.0' },
          popy: { current: '0.2.0-test', latest: undefined },
          node: process.version,
          environment: [{ name: 'ffmpeg', version: '8.0.0-test' }],
          updateCommand: 'test',
        }),
    },
    backups: new TarBackupService({
      dataDir: mkdtempSync(join(tmpdir(), 'popy-test-data-')),
      backupsDir: mkdtempSync(join(tmpdir(), 'popy-test-backups-')),
      now: () => new Date(clock.now()).toISOString(),
    }),
    hub,
    clock,
    versions: { popyVersion: '0.0.0-test', nodeVersion: process.version, piVersion: '0.0.0-test' },
    webDist: WEB_DIST,
  });

  return { app, auth, chats, artifacts, runs, providers, secrets, hub, clock };
}
