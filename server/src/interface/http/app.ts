import type { A2aSettingsService } from '../../application/a2a/a2a-settings.js';
import type { A2aServerProtocol } from '../../application/ports/a2a-server.js';
import { createA2aServerRoutes, createA2aSettingsRoutes } from './a2a-server-routes.js';
import type { UiBridgeService } from '../../application/integrations/ui-bridge-service.js';
import { createUiControlRoutes } from './ui-control-routes.js';
import type { ClientArtifactProvider } from '../../application/ports/client-artifacts.js';
import type { RestClientService } from '../../application/integrations/rest-client-service.js';
import type { IntegrationService } from '../../application/integrations/integration-service.js';
import { createIntegrationRoutes } from './integration-routes.js';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type {
  AboutResponse,
  ProviderSubscriptionUsageResponse,
  ServerInfoResponse,
} from '@pop-agent/shared';
import type { AuthService } from '../../application/auth/auth-service.js';
import type { FilesService } from '../../application/files/files-service.js';
import type { ChatService } from '../../application/chat/chat-service.js';
import type { RunService } from '../../application/chat/run-service.js';
import type { QueuedMessageService } from '../../application/chat/queued-message-service.js';
import type { SessionCommandService } from '../../application/chat/session-command-service.js';
import type { TaskService } from '../../application/tasks/task-service.js';
import type { TaskScheduler } from '../../application/tasks/task-scheduler.js';
import type { BackupService } from '../../application/ports/backup-service.js';
import type { PushService } from '../../application/ports/push-repo.js';
import type { WebAuthnGateway } from '../../application/ports/webauthn-repo.js';
import type { Clock } from '../../application/ports/clock.js';
import type { OAuthFlowService } from '../../application/providers/oauth-flow-service.js';
import type { ProviderService } from '../../application/providers/provider-service.js';
import type { SkillArchiveRepo, SkillsRepo } from '../../application/ports/skills-repo.js';
import type { SkillUsageRepo } from '../../application/ports/skill-usage-repo.js';
import type {
  DistillationRepo,
  SkillRevisionsRepo,
} from '../../application/ports/skill-distillation-repo.js';
import type { Transcriber } from '../../application/ports/transcriber.js';
import type { VoiceCleanup } from '../../application/voice/voice-cleanup.js';
import type { VoiceModelStore } from '../../application/ports/voice-models.js';
import type { UpdateChecker } from '../../application/ports/update-checker.js';
import type { DeploymentCoordinator } from '../../application/update/deployment-coordinator.js';
import type { UsageRepo } from '../../application/ports/usage-repo.js';
import type { StorageService } from '../../application/storage/storage-service.js';
import type { LocalConnectionRegistry } from '../../application/local-access/local-connection-registry.js';
import type { HealthService } from '../../application/health/health-service.js';
import type { McpService } from '../../application/mcp/mcp-service.js';
import type { A2aHttpService } from './a2a-routes.js';
import type { UserMemoryRepo } from '../../application/ports/user-memory-repo.js';
import type { SettingsService } from '../../application/settings/settings-service.js';
import { authMiddleware } from './auth-middleware.js';
import { createCliDownloadRoutes } from './cli-download-routes.js';
import { createCliInstallerRoutes } from './cli-installer-routes.js';
import { createNodeRuntimeRoutes } from './node-runtime-routes.js';
import { createFilesRoutes } from './files-routes.js';
import { createFilesDownloadRoutes } from './files-download-routes.js';
import { createAuthRoutes } from './auth-routes.js';
import { createBackupRoutes } from './backup-routes.js';
import { createPushRoutes } from './push-routes.js';
import { createUpdateRoutes } from './update-routes.js';
import type { PiCandidateService } from '../../application/update/pi-candidate-service.js';
import type { PiActivationService } from '../../application/update/pi-activation-service.js';
import { createVoiceRoutes } from './voice-routes.js';
import { createWebAuthnRoutes } from './webauthn-routes.js';
import {
  createChatRoutes,
  type RejectedLocalSelectionDiagnostic,
} from './chat-routes.js';
import { EventTickets } from './event-tickets.js';
import { createMemoryRoutes } from './memory-routes.js';
import { createProviderRoutes } from './provider-routes.js';
import { mountApi, publicSurface, sessionGuarded } from './route-registry.js';
import { createSkillsRoutes } from './skills-routes.js';
import { createTaskRoutes } from './task-routes.js';
import { createUsageRoutes } from './usage-routes.js';
import { createLocalToolsRoutes } from './local-tools-routes.js';
import { createStorageRoutes } from './storage-routes.js';
import { createSettingsRoutes } from './settings-routes.js';
import { createServerRoutes } from './server-routes.js';
import { type SseHub } from './sse-hub.js';
import { createSyncRoutes, changedSettingsResources } from './sync-routes.js';
import { createStaticSite } from './static-site.js';
import { createMcpRoutes } from './mcp-routes.js';
import { createA2aRoutes } from './a2a-routes.js';
import { apiError } from './errors.js';
import type { ServerOnboardingService } from '../../application/onboarding/server-onboarding-service.js';
import { createOnboardingRoutes } from './onboarding-routes.js';

export interface AppDeps {
  uiBridge?: UiBridgeService;
  integrations?: IntegrationService;
  a2aSettings?: A2aSettingsService;
  a2aProtocol?: A2aServerProtocol;
  restClients?: RestClientService;
  auth: AuthService;
  /** Present only while a fresh guided server install is being completed. */
  onboarding?: ServerOnboardingService;
  /** Stops the temporary private-LAN listener after account setup is durable. */
  onSetupComplete?: () => void;
  settings: SettingsService;
  chats: ChatService;
  /** The user's Files as a plain folder (docs/specs/Spec-Pop-General.md §14). */
  files: FilesService;
  /** Signs Files download links; derived key, from `secret.key` (§9, §14). */
  secretKey: Buffer;
  runs: RunService;
  /** One server-owned follow-up per conversation. */
  queuedMessages: QueuedMessageService;
  sessionCommands: SessionCommandService;
  /** Background tasks (docs/specs/Spec-Pop-General.md §21): the rows, and the queue that runs them. */
  tasks: TaskService;
  taskScheduler: TaskScheduler;
  providers: ProviderService;
  /** The single-active subscription sign-in flow (docs/specs/Spec-Pop-General.md §15). */
  oauthFlows: OAuthFlowService;
  health: HealthService;
  transcriber: Transcriber;
  voiceCleanup: VoiceCleanup;
  voiceModels: VoiceModelStore;
  userMemory: UserMemoryRepo;
  skills: SkillsRepo;
  /** Use counts behind the Skills screen; absent in tests that do not care. */
  skillUsage?: SkillUsageRepo;
  /** The distiller's proposed rewrites, waiting on the Skills screen (§8). */
  skillRevisions?: SkillRevisionsRepo;
  /** The collector's archive, and the way back out of it. */
  skillArchive?: SkillArchiveRepo;
  /** Read for the status line's clock: when the distiller last finished one. */
  distillation?: DistillationRepo;
  distillerEnabled?: () => boolean;
  mcp: McpService;
  /** Outbound Agent2Agent management; omitted until its runtime adapter is wired. */
  a2a?: A2aHttpService;
  usage: UsageRepo;
  storage: StorageService;
  localConnections: LocalConnectionRegistry;
  /** Journal-safe diagnostics for chat requests rejected before mutation. */
  onRejectedLocalSelection: (diagnostic: RejectedLocalSelectionDiagnostic) => void;
  backups: BackupService;
  push: PushService;
  webauthn: WebAuthnGateway;
  updates: UpdateChecker;
  /** Isolated pi candidate staging and its external activation handoff. */
  piCandidates?: PiCandidateService;
  piActivation?: PiActivationService;
  /** Safe hand-off from the running commit to the committed checkout on disk. */
  deployment?: DeploymentCoordinator;
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
  /** Provider subscription allowance; absent/undefined means it publishes none. */
  subscriptionUsage?: (
    providerId: string,
  ) => Promise<ProviderSubscriptionUsageResponse | undefined>;
  /** Directory holding the built frontend (web/dist). */
  webDist: string;
  /** Directory holding the current packed CLI release and public manifests. */
  cliPack: string;
  clientArtifacts?: ClientArtifactProvider;
  /** Durable history of immutable CLI tarballs across checkout replacement. */
  cliArchive?: string;
}

// A 100 MiB chat attachment batch becomes just under 134 MiB after base64
// encoding. Keep the global parser ceiling above that documented route limit;
// each route still applies its smaller semantic cap before doing work.
const MAX_API_BODY_BYTES = 140 * 1024 * 1024;

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  // Bound the bytes before JSON/multipart parsers allocate them. Individual
  // routes still enforce their smaller semantic limits (Files is 100 MiB; PLA
  // frames are 12 MiB), while this ceiling catches every forgotten route.
  app.use('/v1/*', bodyLimit({
    maxSize: MAX_API_BODY_BYTES,
    onError: (c) => apiError(c, 413, 'too_large', 'This request body is too large.'),
  }));

  // Liveness and the sidebar's health probe (docs/specs/Spec-Pop-General.md §13), as their own
  // mini-app so the typed registry below can bless them explicitly.
  const health = new Hono();
  health.get('/healthz', (c) => c.json({ ok: true }));
  health.get('/v1/health', (c) => c.json(deps.health.report()));

  // The typed route registry (docs/specs/Spec-Pop-General.md §9): every group is either
  // session-guarded or a declared public surface with a written reason --
  // an unauthenticated URL cannot be mounted by accident, and the probe in
  // route-guard.test.ts verifies the runtime half of the same invariant.
  app.use('/v1/*', async (c, next) => {
    await next();
    if (c.res.status >= 200 && c.res.status < 300) {
      const keys = changedSettingsResources(c.req.method, c.req.path);
      if (keys.length) deps.hub.invalidate(keys);
    }
  });
  // File URLs are not bearer capabilities: even an old valid signature requires
  // a current owner session, including after password changes or revocation.
  app.use('/files/download', authMiddleware(deps.auth));
  mountApi(app, authMiddleware(deps.auth, deps.integrations), {
    public: [
      ...(deps.a2aSettings && deps.a2aProtocol ? [publicSurface('A2A card and protocol enforce their own independent enabled switch, IP allowlist and bearer key.', createA2aServerRoutes(deps.a2aSettings, deps.a2aProtocol))] : []),
      publicSurface(
        'liveness and the health dot leak only ok/error flags, and a session check here would make "signed out" indistinguishable from "server down"',
        health,
      ),
      publicSurface(
        'Files downloads require the explicit owner-session middleware above as well as the path/expiry signature and filesystem jail; this non-v1 route must precede the static site',
        createFilesDownloadRoutes(deps),
      ),
      publicSurface(
        'the native launcher must discover and download the matching CLI before a session or Node client exists (docs/cli.md, Distribution); manifests, launcher binaries and the client tarball carry only public code/version/checksum metadata, never secrets or user data',
        createCliDownloadRoutes(deps),
      ),
      publicSurface(
        'the macOS/Linux and Windows bootstrap scripts must run before a session or CLI exists; they contain only this request origin and checksummed public launcher artifact metadata',
        createCliInstallerRoutes(deps),
      ),
      publicSurface(
        'the native launcher must obtain the exact checksummed managed Node runtime before a session or Node client exists; the manifest and archive contain only public runtime bytes and release metadata',
        createNodeRuntimeRoutes(deps),
      ),
    ],
    guarded: [
      sessionGuarded(createSyncRoutes(deps.hub)),
      ...(deps.a2aSettings && deps.a2aProtocol ? [sessionGuarded(createA2aSettingsRoutes(deps.a2aSettings, deps.a2aProtocol))] : []),
      ...(deps.uiBridge && deps.integrations ? [sessionGuarded(createUiControlRoutes(deps.uiBridge, deps.integrations))] : []),
      ...(deps.integrations === undefined ? [] : [sessionGuarded(createIntegrationRoutes(deps.integrations, deps.chats, deps.restClients))]),
      sessionGuarded(createAuthRoutes(deps)),
      ...(deps.onboarding === undefined
        ? []
        : [sessionGuarded(createOnboardingRoutes(deps.onboarding))]),
      sessionGuarded(createWebAuthnRoutes(deps)),
      sessionGuarded(createSettingsRoutes(deps)),
      sessionGuarded(createServerRoutes(deps)),
      sessionGuarded(createProviderRoutes(deps)),
      sessionGuarded(createMemoryRoutes(deps)),
      sessionGuarded(
        createSkillsRoutes({
          skills: deps.skills,
          ...(deps.skillUsage === undefined ? {} : { usage: deps.skillUsage }),
          ...(deps.skillRevisions === undefined ? {} : { revisions: deps.skillRevisions }),
          ...(deps.skillArchive === undefined ? {} : { archive: deps.skillArchive }),
          ...(deps.distillation === undefined ? {} : { distillation: deps.distillation }),
          ...(deps.distillerEnabled === undefined ? {} : { distillerEnabled: deps.distillerEnabled }),
          now: () => deps.clock.now(),
        }),
      ),
      sessionGuarded(createMcpRoutes(deps.mcp)),
      ...(deps.a2a === undefined ? [] : [sessionGuarded(createA2aRoutes(deps.a2a))]),
      sessionGuarded(createUsageRoutes(deps)),
      sessionGuarded(createStorageRoutes(deps)),
      sessionGuarded(createLocalToolsRoutes(deps)),
      sessionGuarded(
        createUpdateRoutes({
          updates: deps.updates,
          ...(deps.deployment === undefined ? {} : { deployment: deps.deployment }),
          ...(deps.piCandidates === undefined ? {} : { piCandidates: deps.piCandidates }),
          ...(deps.piActivation === undefined ? {} : { piActivation: deps.piActivation }),
        }),
      ),
      sessionGuarded(createVoiceRoutes(deps)),
      sessionGuarded(createBackupRoutes(deps)),
      sessionGuarded(createPushRoutes(deps)),
      sessionGuarded(createFilesRoutes(deps)),
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
