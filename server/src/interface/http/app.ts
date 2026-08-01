import { Hono } from 'hono';
import type { AboutResponse, ServerInfoResponse } from '@popy/shared';
import type { AuthService } from '../../application/auth/auth-service.js';
import type { ArtifactService } from '../../application/artifacts/artifact-service.js';
import type { ChatService } from '../../application/chat/chat-service.js';
import type { RunService } from '../../application/chat/run-service.js';
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
import type { HealthService } from '../../application/health/health-service.js';
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
import { createSkillsRoutes } from './skills-routes.js';
import { createUsageRoutes } from './usage-routes.js';
import { createSettingsRoutes } from './settings-routes.js';
import { createServerRoutes } from './server-routes.js';
import { SseHub } from './sse-hub.js';
import { createStaticSite } from './static-site.js';

export interface AppDeps {
  auth: AuthService;
  settings: SettingsService;
  chats: ChatService;
  artifacts: ArtifactService;
  runs: RunService;
  providers: ProviderService;
  /** The single-active subscription sign-in flow (popy.spec §15). */
  oauthFlows: OAuthFlowService;
  health: HealthService;
  transcriber: Transcriber;
  voiceCleanup: VoiceCleanup;
  voiceModels: VoiceModelStore;
  userMemory: UserMemoryRepo;
  skills: SkillsRepo;
  usage: UsageRepo;
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

  app.get('/healthz', (c) => c.json({ ok: true }));

  // The sidebar's health probe (popy.spec §13): public like /healthz -- it
  // leaks nothing but ok/error flags, and a session check here would make
  // "signed out" indistinguishable from "server down".
  app.get('/v1/health', (c) => c.json(deps.health.report()));

  // The signed artifact download carries no session -- the HMAC in the URL is
  // the whole authorisation (popy.spec §14) -- so it sits before the /v1 guard
  // and before the static site could mistake it for a missing file.
  app.route('/', createArtifactDownloadRoutes(deps));

  // Guard everything under /v1 except the handful of public auth endpoints.
  app.use('/v1/*', authMiddleware(deps.auth));
  app.route('/v1', createAuthRoutes(deps));
  app.route('/v1', createWebAuthnRoutes(deps));
  app.route('/v1', createSettingsRoutes(deps));
  app.route('/v1', createServerRoutes(deps));
  app.route('/v1', createProviderRoutes(deps));
  app.route('/v1', createMemoryRoutes(deps));
  app.route('/v1', createSkillsRoutes(deps));
  app.route('/v1', createUsageRoutes(deps));
  app.route('/v1', createUpdateRoutes(deps));
  app.route('/v1', createVoiceRoutes(deps));
  app.route('/v1', createBackupRoutes(deps));
  app.route('/v1', createPushRoutes(deps));
  app.route('/v1', createArtifactRoutes(deps));
  app.route('/v1', createChatRoutes({ ...deps, tickets: new EventTickets(deps.clock) }));

  // Last: anything that is not an API route is the frontend or a 404.
  app.use(createStaticSite(deps.webDist));

  app.notFound((c) =>
    c.json({ error: { code: 'not_found', message: 'Route not found', status: 404 } }, 404),
  );

  return app;
}
