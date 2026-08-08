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
import { HealthService } from '../application/health/health-service.js';
import type { Clock } from '../application/ports/clock.js';
import type { ProviderAuthInteraction } from '../application/ports/agent-bridge.js';
import type { PasswordHasher } from '../application/ports/password-hasher.js';
import type { CompletionRequest, ProviderGateway } from '../application/ports/provider-gateway.js';
import type { SecretsRepo } from '../application/ports/secrets-repo.js';
import type { SettingsRepo } from '../application/ports/settings-repo.js';
import { OAuthFlowService } from '../application/providers/oauth-flow-service.js';
import { ProviderCooldown } from '../application/providers/provider-cooldown.js';
import { ProviderService } from '../application/providers/provider-service.js';
import { SettingsService } from '../application/settings/settings-service.js';
import { TaskScheduler } from '../application/tasks/task-scheduler.js';
import { TaskService } from '../application/tasks/task-service.js';
import type { Timer } from '../application/ports/timer.js';
import { FakeAgentBridge } from '../infrastructure/agent/fake-bridge.js';
import { FsChatPurger } from '../infrastructure/agent/chat-purger.js';
import { StorageService } from '../application/storage/storage-service.js';
import { HandsRegistry } from '../application/hands/hands-registry.js';
import { SqliteStorageRepo } from '../infrastructure/db/sqlite-storage-repo.js';
import { NodeDiskUsage } from '../infrastructure/storage/node-disk-usage.js';
import { FilesService } from '../application/files/files-service.js';
import { migrate } from '../infrastructure/db/migrate.js';
import { SqliteChatRepo } from '../infrastructure/db/sqlite-chat-repo.js';
import { SqliteTaskRepo } from '../infrastructure/db/sqlite-task-repo.js';
import { SqliteUsageRepo } from '../infrastructure/db/sqlite-usage-repo.js';
import { SqliteUserMemoryRepo } from '../infrastructure/db/sqlite-user-memory-repo.js';
import { SkillsVault } from '../infrastructure/skills/skills-vault.js';
import { SqliteSkillUsageRepo } from '../infrastructure/db/sqlite-skill-usage-repo.js';
import {
  SqliteDistillationRepo,
  SqliteSkillRevisionsRepo,
} from '../infrastructure/db/sqlite-skill-distillation-repo.js';
import { TarBackupService } from '../infrastructure/backup/tar-backup-service.js';
import { WebAuthnService } from '../infrastructure/auth/webauthn-service.js';
import { SqliteWebAuthnRepo } from '../infrastructure/db/sqlite-webauthn-repo.js';
import { SqliteLlmRunsRepo } from '../infrastructure/db/sqlite-llm-runs-repo.js';
import { SqliteMcpRepo } from '../infrastructure/db/sqlite-mcp-repo.js';
import { McpService } from '../application/mcp/mcp-service.js';
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
/** The packed client (docs/cli.md, Distribution); absent unless `pack:cli` ran. */
export const CLI_PACK = fileURLToPath(new URL('../../../cli/pack', import.meta.url));

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

/**
 * The engine's subscription-auth surface, scripted (pop-agent.spec §15). The
 * default login shows one URL, asks for one code and accepts only
 * "good-code" -- enough to walk the whole wire without pi or a browser.
 */
export class FakeProviderAuth {
  /** Providers the fake engine considers signed in. */
  readonly authed = new Set<string>();

  login = (providerId: string, interaction: ProviderAuthInteraction): Promise<void> => {
    interaction.notify({ type: 'auth_url', url: 'https://example.test/oauth', instructions: 'Open and approve' });
    return interaction
      .prompt({ type: 'manual_code', message: 'Paste the code shown after approving' })
      .then((code) => {
        if (code !== 'good-code') throw new Error('invalid code');
        this.authed.add(providerId);
      });
  };
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

/** A timer that never fires: the tests drive the scheduler by hand. */
const inertTimer: Timer = { every: () => () => undefined };

export interface TestApp {
  app: Hono;
  /** Danger-zone calls the test inspects (LOTE 6). */
  controlLog: string[];
  auth: AuthService;
  chats: ChatService;
  /** The user's Files over a throwaway tree (pop-agent.spec §14). */
  files: FilesService;
  runs: RunService;
  tasks: TaskService;
  taskScheduler: TaskScheduler;
  /** The throwaway POP_AGENT_WORKSPACE this app's purger and sweeps act on. */
  workspace: string;
  providers: ProviderService;
  /** The scripted subscription auth behind the oauth routes. */
  providerAuth: FakeProviderAuth;
  secrets: MemorySecrets;
  hub: SseHub;
  clock: FakeClock;
  /** The throwaway skills vault behind /v1/skills. */
  skills: SkillsVault;
  /** Use counts behind the same routes. */
  skillUsage: SqliteSkillUsageRepo;
  /** The distiller's proposed rewrites, so a route test can plant one. */
  skillRevisions: SqliteSkillRevisionsRepo;
  /** Its watermarks, which the status line reads for its clock. */
  distillation: SqliteDistillationRepo;
}

export interface TestAppOptions {
  /** Scripted provider balance for the credits route (LOTE 6). */
  credits?: { remaining: number; used: number };

  /** Swap in a scripted gateway to test the provider routes. */
  gateway?: ProviderGateway;
  /** Stands in for OPENROUTER_API_KEY in the environment. */
  envKey?: string;
  /** Swap in a scripted transcriber to test the voice route. */
  transcriber?: FakeTranscriber;
  /** Swap in a pre-seeded subscription-auth fake to test the oauth routes. */
  providerAuth?: FakeProviderAuth;
  /** Drive the task scheduler's tick by hand (pop-agent.spec §21). */
  timer?: Timer;
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
  // Exposed on the fixture: a route test needs to plant a skill the CRUD
  // cannot create -- a pending one, which only the agent's tool writes.
  const skills = new SkillsVault(mkdtempSync(join(tmpdir(), 'pop-test-skills-')));
  const skillUsage = new SqliteSkillUsageRepo(db);
  const skillRevisions = new SqliteSkillRevisionsRepo(db);
  const distillation = new SqliteDistillationRepo(db);

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

  const gateway = options.gateway ?? new RefusingGateway();
  const providerAuth = options.providerAuth ?? new FakeProviderAuth();
  const cooldown = new ProviderCooldown({ clock });
  const providers = new ProviderService({
    secrets,
    settings: settingsRepo,
    gateways: { openrouter: gateway },
    // Custom instances test against the same scripted gateway.
    customGateway: () => gateway,
    clock,
    envKey: () => options.envKey,
    engineModels: () => bridge.listModels(),
    engineHasAuth: (providerId) => providerAuth.authed.has(providerId),
    // The engine path answers through the same scripted gateway, so a test
    // reads the same script whichever door the completion came through.
    engineComplete: (request) =>
      providerAuth.authed.has(request.providerId)
        ? gateway.complete({
            apiKey: 'engine',
            model: request.modelId,
            prompt: request.prompt,
            maxTokens: request.maxTokens ?? 64,
          })
        : Promise.reject(new Error('Not signed in.')),
    engineLogout: (providerId) => {
      providerAuth.authed.delete(providerId);
      return Promise.resolve();
    },
    cooldown,
    defaults: () => {
      const current = settings.read();
      return { provider: current.defaultProvider, model: current.defaultModel };
    },
  });
  const oauthFlows = new OAuthFlowService({
    login: (providerId, interaction) => providerAuth.login(providerId, interaction),
    onSuccess: (providerId) => cooldown.clear(providerId),
  });

  const settings = new SettingsService(settingsRepo);
  // Files as a plain folder (pop-agent.spec §14): a real service over a throwaway
  // tree, exactly as main.ts wires it.
  const files = new FilesService({
    root: mkdtempSync(join(tmpdir(), 'pop-test-files-')),
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
    resolveChain: (override) => providers.resolveChain(override),
    cooldown,
    titles: new TitleService({
      chats: chatRepo,
      complete: async (request, ctx) => (await providers.completeAsService(request, ctx)).text,
      sink: hub,
    }),
  });

  // Wired exactly the way main.ts wires it (pop-agent.spec §6): a delete stops the
  // chat's work first, then purges what it left in the workspace. The
  // workspace is a throwaway directory, so a test can look at it.
  const workspace = mkdtempSync(join(tmpdir(), 'pop-test-workspace-'));
  // One throwaway data directory, shared by the pieces that measure it.
  const dataDir = mkdtempSync(join(tmpdir(), 'pop-test-data-'));
  const mcp = new McpService({ repo: new SqliteMcpRepo(db), secrets: new MemorySecrets(), dataDir });
  const chats = new ChatService({
    chats: chatRepo,
    clock,
    runs,
    purger: new FsChatPurger({ workspace, forgetSession: () => undefined }),
  });

  // Background tasks (pop-agent.spec §21). The timer is inert: nothing ticks by
  // itself in a test, and `run-now` drives the queue directly.
  const taskRepo = new SqliteTaskRepo(db);
  const tasks = new TaskService({ tasks: taskRepo, clock });
  const taskScheduler = new TaskScheduler({
    tasks: taskRepo,
    chats,
    runs,
    clock,
    timer: options.timer ?? inertTimer,
  });

  const controlLog: string[] = [];
  const app = createApp({
    auth,
    settings,
    chats,
    files,
    secretKey: Buffer.from('test-artifact-signing-key-000000'),
    runs,
    tasks,
    taskScheduler,
    providers,
    oauthFlows,
    health: new HealthService({
      providers,
      pingDb: () => {
        db.prepare('SELECT 1').get();
      },
    }),
    transcriber: options.transcriber ?? new FakeTranscriber(),
    voiceCleanup: { clean: (text: string) => Promise.resolve(text) } as never,
    voiceModels: {
      status: () => Promise.resolve([{ name: 'medium', approxMb: 1530, installed: true }]),
      ensure: () => Promise.resolve('/models/ggml-medium.bin'),
    },
    userMemory: new SqliteUserMemoryRepo(db),
    skills,
    skillUsage,
    skillRevisions,
    skillArchive: skills,
    distillation,
    distillerEnabled: () => true,
    mcp,
    usage: new SqliteUsageRepo(db),
    // No terminal ever attaches in a fixture; the registry is here so the
    // shape is complete and the routes mount.
    hands: new HandsRegistry(),
    // A real service over a throwaway directory: the report has to survive
    // folders that do not exist, which is exactly the fixture's shape.
    storage: new StorageService({
      repo: new SqliteStorageRepo(db),
      disk: new NodeDiskUsage(),
      dataDir,
      filesDir: join(dataDir, 'files'),
      workspace,
      backupsDir: join(dataDir, 'backups'),
      modelDirs: [join(dataDir, 'voice-models')],
    }),
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
          popAgent: { current: '0.2.0-test', latest: undefined },
          node: process.version,
          environment: [{ name: 'ffmpeg', version: '8.0.0-test' }],
          updateCommand: 'test',
        }),
    },
    backups: new TarBackupService({
      dataDir,
      backupsDir: mkdtempSync(join(tmpdir(), 'pop-test-backups-')),
      now: () => new Date(clock.now()).toISOString(),
    }),
    hub,
    clock,
    versions: { popAgentVersion: '0.0.0-test', nodeVersion: process.version, piVersion: '0.0.0-test' },
    ...(options.credits === undefined
      ? {}
      : { credits: () => Promise.resolve(options.credits) }),
    serverControl: {
      restart: () => {
        controlLog.push('restart');
      },
      stop: () => {
        controlLog.push('stop');
      },
      llmStop: () => runs.stopLlm(),
      llmStart: () => runs.startLlm(),
    },
    serverInfo: () =>
      ({
        cpu: { model: 'Test CPU', cores: 2, load: [0, 0, 0] },
        memory: { total: 1024, used: 512 },
        disk: { total: 4096, free: 2048 },
        uptimeSeconds: 60,
        processUptimeSeconds: 30,
        timezone: 'UTC',
        serverTime: new Date(FIXED_NOW).toISOString(),
        nodeVersion: process.version,
        popAgentVersion: '0.0.0-test',
        commit: 'abc1234',
        dbBytes: 100,
        workspaceBytes: 200,
        dataDir: '/tmp/data',
        workspace: '/tmp/workspace',
      }) satisfies import('@pop-agent/shared').ServerInfoResponse,
    webDist: WEB_DIST,
    cliPack: CLI_PACK,
  });

  return {
    controlLog,
    app,
    auth,
    chats,
    files,
    runs,
    tasks,
    taskScheduler,
    workspace,
    providers,
    providerAuth,
    secrets,
    hub,
    clock,
    skills,
    skillUsage,
    skillRevisions,
    distillation,
  };
}
