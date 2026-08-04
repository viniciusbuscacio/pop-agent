import { Hono } from 'hono';
import type { AboutResponse, ServerInfoResponse } from '@popy/shared';
import type { AuthService } from '../../application/auth/auth-service.js';
import type { ArtifactService } from '../../application/artifacts/artifact-service.js';
import type { PathIndexService } from '../../application/artifacts/path-index.js';
import type { ChatService } from '../../application/chat/chat-service.js';
import type { RunService } from '../../application/chat/run-service.js';
import type { TaskService } from '../../application/tasks/task-service.js';
import type { TaskScheduler } from '../../application/tasks/task-scheduler.js';
import type { BackupService } from '../../application/ports/backup-service.js';
import type { PushService } from '../../application/ports/push-repo.js';
import type { WebAuthnGateway } from '../../application/ports/webauthn-repo.js';
import type { Clock } from '../../application/ports/clock.js';
import type { OAuthFlowService } from '../../application/providers/oauth-flow-service.js';
import type { ProviderService } from '../../application/providers/provider-service.js';
import type { SkillsRepo } from '../../application/ports/skills-repo.js';
import type { Transcriber } from '../../application/ports/transcriber.js';
import type { VoiceCleanup } from '../../application/voice/voice-cleanup.js';
import type { VoiceModelStore } from '../../application/ports/voice-models.js';
import type { UpdateChecker } from '../../application/ports/update-checker.js';
import type { UsageRepo } from '../../application/ports/usage-repo.js';
import type { StorageService } from '../../application/storage/storage-service.js';
import type { HandsRegistry } from '../../application/hands/hands-registry.js';
import type { HealthService } from '../../application/health/health-service.js';
import type { McpService } from '../../application/mcp/mcp-service.js';
import type { UserMemoryRepo } from '../../application/ports/user-memory-repo.js';
import type { SettingsService } from '../../application/settings/settings-service.js';
import { authMiddleware } from './auth-middleware.js';
import { createArtifactRoutes } from './artifact-routes.js';
import { createArtifactDownloadRoutes } from './artifact-download-routes.js';
import { createAuthRoutes } from './auth-routes.js';
import { createBackupRoutes } from './backup-routes.js';
import { createPushRoutes } from './push-routes.js';
import { createUpdateRoutes } from './update-routes.js';
import { createVoiceRoutes } from './voice-routes.js';
import { createWebAuthnRoutes } from './webauthn-routes.js';
import { createChatRoutes } from './chat-routes.js';
import { EventTickets } from './event-tickets.js';
import { createMemoryRoutes } from './memory-routes.js';
import { createProviderRoutes } from './provider-routes.js';
import { mountApi, publicSurface, sessionGuarded } from './route-registry.js';
import { createSkillsRoutes } from './skills-routes.js';
import { createTaskRoutes } from './task-routes.js';
import { createUsageRoutes } from './usage-routes.js';
import { createHandsRoutes } from './hands-routes.js';
import { createStorageRoutes } from './storage-routes.js';
import { createSettingsRoutes } from './settings-routes.js';
import { createServerRoutes } from './server-routes.js';
import { SseHub } from './sse-hub.js';
import { createStaticSite } from './static-site.js';
import { createMcpRoutes } from './mcp-routes.js';

export interface AppDeps {
  auth: AuthService;
  settings: SettingsService;
  chats: ChatService;
  artifacts: ArtifactService;
  /** The Files search index (popy.spec §14): powers GET /files/search. */
  pathIndex: PathIndexService;
  runs: RunService;
  /** Background tasks (popy.spec §21): the rows, and the queue that runs them. */
  tasks: TaskService;
  taskScheduler: TaskScheduler;
  providers: ProviderService;
  /** The single-active subscription sign-in flow (popy.spec §15). */
  oauthFlows: OAuthFlowService;
  health: HealthService;
  transcriber: Transcriber;
  voiceCleanup: VoiceCleanup;
  voiceModels: VoiceModelStore;
  userMemory: UserMemoryRepo;
  skills: SkillsRepo;
  mcp: McpService;
  usage: UsageRepo;
  storage: StorageService;
  hands: HandsRegistry;
  backups: BackupService;
  push: PushService;
  webauthn: WebAuthnGateway;
  updates: UpdateChecker;
  /** The sink the run service emits into; the hub is its adapter. */
  hub: SseHub;
  clock: Clock;
  /**
   * Read once at boot: versions cannot change while the process runs, so a
   * port with a live reader would buy nothing.
   */
  versions: AboutResponse;
  /** Settings -> Server snapshot: measured on each read, so a function. */
  serverInfo: () => ServerInfoResponse;
  /** Settings -> Server danger zone (LOTE 6). See server-routes.ts. */
  serverControl: {
    restart(): void;
    stop(): void;
    llmStop(): number;
    llmStart(): void;
  };
  /** Provider balance lookup (LOTE 6); absent means "no balance to show". */
  credits?: (providerId: string) => Promise<{ remaining: number; used: number } | undefined>;
  /** Directory holding the built frontend (web/dist). */
  webDist: string;
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  // Liveness and the sidebar's health probe (popy.spec §13), as their own
  // mini-app so the typed registry below can bless them explicitly.
  const health = new Hono();
  health.get('/healthz', (c) => c.json({ ok: true }));
  health.get('/v1/health', (c) => c.json(deps.health.report()));

  // The typed route registry (popy.spec §9): every group is either
  // session-guarded or a declared public surface with a written reason --
  // an unauthenticated URL cannot be mounted by accident, and the probe in
  // route-guard.test.ts verifies the runtime half of the same invariant.
  mountApi(app, authMiddleware(deps.auth), {
    public: [
      publicSurface(
        'liveness and the health dot leak only ok/error flags, and a session check here would make "signed out" indistinguishable from "server down"',
        health,
      ),
      publicSurface(
        'the HMAC in the artifact download URL is the whole authorisation (popy.spec §14); it must sit before the static site could mistake it for a missing file',
        createArtifactDownloadRoutes(deps),
      ),
    ],
    guarded: [
      sessionGuarded(createAuthRoutes(deps)),
      sessionGuarded(createWebAuthnRoutes(deps)),
      sessionGuarded(createSettingsRoutes(deps)),
      sessionGuarded(createServerRoutes(deps)),
      sessionGuarded(createProviderRoutes(deps)),
      sessionGuarded(createMemoryRoutes(deps)),
      sessionGuarded(createSkillsRoutes(deps)),
      sessionGuarded(createMcpRoutes(deps.mcp)),
      sessionGuarded(createUsageRoutes(deps)),
      sessionGuarded(createStorageRoutes(deps)),
      sessionGuarded(createHandsRoutes(deps)),
      sessionGuarded(createUpdateRoutes(deps)),
      sessionGuarded(createVoiceRoutes(deps)),
      sessionGuarded(createBackupRoutes(deps)),
      sessionGuarded(createPushRoutes(deps)),
      sessionGuarded(createArtifactRoutes(deps)),
      sessionGuarded(createTaskRoutes(deps)),
      sessionGuarded(createChatRoutes({ ...deps, tickets: new EventTickets(deps.clock) })),
    ],
  });

  // Last: anything that is not an API route is the frontend or a 404.
  app.use(createStaticSite(deps.webDist));

  app.notFound((c) =>
    c.json({ error: { code: 'not_found', message: 'Route not found', status: 404 } }, 404),
  );

  return app;
}
