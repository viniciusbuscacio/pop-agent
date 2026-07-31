import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { AuthService } from './application/auth/auth-service.js';
import { ChatService } from './application/chat/chat-service.js';
import { RunService } from './application/chat/run-service.js';
import { TitleService } from './application/chat/title-service.js';
import type { AgentBridge } from './application/ports/agent-bridge.js';
import { systemClock } from './application/ports/clock.js';
import { ProviderService } from './application/providers/provider-service.js';
import { SettingsService } from './application/settings/settings-service.js';
import { FakeAgentBridge } from './infrastructure/agent/fake-bridge.js';
import { FsChatPurger } from './infrastructure/agent/chat-purger.js';
import { FsArtifactStore } from './infrastructure/artifacts/artifact-store.js';
import { ArtifactService } from './application/artifacts/artifact-service.js';
import { FileIndexer } from './application/artifacts/file-indexer.js';
import { BinaryArtifactExtractor } from './infrastructure/artifacts/artifact-extractor.js';
import { PiAgentBridge } from './infrastructure/agent/pi-bridge.js';
import { SdkPiEngine } from './infrastructure/agent/pi-engine.js';
import { NotesVault } from './infrastructure/notes/notes-vault.js';
import { SkillsVault } from './infrastructure/skills/skills-vault.js';
import { TransformersEmbedder } from './infrastructure/embeddings/transformers-embedder.js';
import { WhisperModelStore } from './infrastructure/voice/whisper-models.js';
import { VoiceCleanup } from './application/voice/voice-cleanup.js';
import { HybridMemory } from './application/memory/hybrid-memory.js';
import { EmbeddingIndexer } from './application/memory/embedding-indexer.js';
import { SkillRouterService } from './application/skills/skill-router-service.js';
import { pinnedBodies } from './domain/skills/skill-router.js';
import { Argon2PasswordHasher } from './infrastructure/auth/argon2-hasher.js';
import { bootstrap } from './infrastructure/bootstrap.js';
import { ensureWorkspace, resolveWorkspace, ensureArtifactsDir } from './infrastructure/config/data-dir.js';
import { readVersions } from './infrastructure/config/versions.js';
import { TarBackupService } from './infrastructure/backup/tar-backup-service.js';
import { OpenRouterGateway } from './infrastructure/providers/openrouter-gateway.js';
import { WebPushService } from './infrastructure/push/web-push-service.js';
import { WebAuthnService } from './infrastructure/auth/webauthn-service.js';
import { isNewerVersion, NpmUpdateChecker } from './infrastructure/update/npm-update-checker.js';
import { readEnvironmentVersions } from './infrastructure/update/environment-versions.js';
import { WhisperTranscriber } from './infrastructure/voice/whisper-transcriber.js';
import { createApp } from './interface/http/app.js';
import { SseHub } from './interface/http/sse-hub.js';

const port = Number(process.env['POPY_PORT'] ?? 8787);
const hostname = process.env['POPY_BIND'] ?? '127.0.0.1';

// Resolves the same from src/ (tsx) and dist/ (compiled): both sit two levels
// below the repo root.
const webDist = fileURLToPath(new URL('../../web/dist', import.meta.url));

// Composition root: the one place that knows every layer (popy.spec §3).
const context = bootstrap();

const auth = new AuthService({
  settings: context.settings,
  secrets: context.secrets,
  hasher: new Argon2PasswordHasher(),
  clock: systemClock,
});

// Which engine answers (popy.spec §4). `fake` is scripted and free; `pi` is
// the real thing and spends money. A typo must not quietly pick either.
const agent = process.env['POPY_AGENT'] ?? 'pi';
if (agent !== 'fake' && agent !== 'pi') {
  throw new Error(`POPY_AGENT must be "fake" or "pi", got "${agent}"`);
}

const workspace = ensureWorkspace(resolveWorkspace());
const artifactsDir = ensureArtifactsDir(context.dataDir);
// Artifacts: the agent's outputs and the user's uploads, tracked per chat and
// downloadable only through an HMAC-signed link keyed off secret.key (§14).
// Built before the bridge so the pi engine can hand the agent save_artifact.
// A holder, not a let: the service is built before the embedder exists.
const fileIndex: { current: FileIndexer | undefined } = { current: undefined };
const artifacts = new ArtifactService({
  repo: context.artifacts,
  folders: context.folders,
  store: new FsArtifactStore(artifactsDir),
  secretKey: context.secretKey,
  clock: systemClock,
  // Off the request path: a stored file is indexed for files_search moments later.
  onStored: (artifactId) => void fileIndex.current?.index(artifactId),
});
// Best-effort text extraction for read_artifact: PDF/DOCX/OCR via system
// binaries (popy.spec §14). Paths overridable for an unusual install.
const artifactExtractor = new BinaryArtifactExtractor({
  ...(process.env['POPY_PDFTOTEXT'] === undefined ? {} : { pdftotext: process.env['POPY_PDFTOTEXT'] }),
  ...(process.env['POPY_UNZIP'] === undefined ? {} : { unzip: process.env['POPY_UNZIP'] }),
  ...(process.env['POPY_TESSERACT'] === undefined ? {} : { tesseract: process.env['POPY_TESSERACT'] }),
  ...(process.env['POPY_OCR_LANGS'] === undefined ? {} : { ocrLanguages: process.env['POPY_OCR_LANGS'] }),
});
const settings = new SettingsService(context.settings);
// The agent's own notes vault (popy.spec §11), inside the data directory.
const notesVault = new NotesVault(join(context.dataDir, 'notes'));
// The skills vault (popy.spec §8): seeds the defaults on first boot.
const skillsVault = new SkillsVault(join(context.dataDir, 'skills'));

// Local embeddings power semantic memory and skill routing (popy.spec §7, §8).
// Built only for the real agent -- the fake bridge never embeds anything -- and
// the model downloads on first use into the data directory.
const embedder =
  agent === 'pi'
    ? new TransformersEmbedder({ cacheDir: join(context.dataDir, 'models') })
    : undefined;
const hybridMemory = new HybridMemory({
  memory: context.memory,
  embeddings: context.embeddings,
  ...(embedder === undefined ? {} : { embedder }),
});
// Selections are logged so router thresholds are tuned from data, not guessed
// (popy.spec §8). Slugs and scores only -- message content stays out of logs.
const skillRouter = new SkillRouterService(skillsVault, embedder, (selection) => {
  const picked =
    selection.length === 0
      ? 'none'
      : selection.map((entry) => `${entry.slug}=${entry.score.toFixed(2)}`).join(' ');
  console.log(`popy skills: ${picked}`);
});
const indexer =
  embedder === undefined
    ? undefined
    : new EmbeddingIndexer({
        embeddings: context.embeddings,
        embedder,
        onError: (message) => console.warn(`popy embedding: ${message}`),
      });
// The semantic index over Files (§14): the agent learns from what the user keeps.
fileIndex.current =
  embedder === undefined
    ? undefined
    : new FileIndexer({
        artifacts,
        chunks: context.artifactChunks,
        embedder,
        extractor: artifactExtractor,
        onError: (message) => console.warn(`popy file index: ${message}`),
      });

const bridge: AgentBridge = agent === 'pi' ? piBridge() : new FakeAgentBridge();

// The provider seen by the routes: key precedence (secrets over environment),
// the key test, and the model catalog with the engine's as offline fallback.
const gateway = new OpenRouterGateway();
const providers = new ProviderService({
  secrets: context.secrets,
  settings: context.settings,
  gateway,
  clock: systemClock,
  envKey: () => process.env['OPENROUTER_API_KEY'],
  engineModels: () => bridge.listModels(),
});

function piBridge(): PiAgentBridge {
  return new PiAgentBridge({
    chats: context.chats,
    workspace,
    // The Skill Router picks the few relevant skills for each message (lexical
    // + semantic) and returns their bodies for the bridge to prepend (§8).
    skillsFor: (message) => skillRouter.route(message),
    engine: new SdkPiEngine({
      workspace,
      sessionsDir: join(context.dataDir, 'sessions'),
      // pi's own config, credentials and catalog cache, all inside Popy's data
      // directory: a ~/.pi on the host must not reach into this process.
      agentDir: join(context.dataDir, 'pi-agent'),
      authPath: join(context.dataDir, 'pi-auth.json'),
      modelsStorePath: join(context.dataDir, 'pi-models-store.json'),
      apiKey: () => providers.apiKey(),
      notesVault,
      memory: context.memory,
      memorySearch: hybridMemory,
      userMemory: context.userMemory,
      artifacts,
      artifactExtractor,
      ...(fileIndex.current === undefined ? {} : { fileSearch: fileIndex.current }),
    }),
    defaultModelId: () => settings.read().defaultModel,
    // Pinned skills lead the session's system prompt (popy.spec §8): identity
    // is not left to a per-turn router. The bridge reopens a session when this
    // string changes, so a pin edit reaches the next run.
    instructions: () =>
      [...pinnedBodies(skillsVault.all()), settings.read().customInstructions]
        .filter((block) => block.trim().length > 0)
        .join('\n\n'),
    // Until Phase 3 step 4 gives them a table, both land in the log -- which is
    // still the difference between "it failed" and knowing why.
    onUsage: (usage) => {
      console.log(
        `popy run usage: chat=${usage.chatId} model=${usage.model} ` +
          `in=${String(usage.inputTokens)} out=${String(usage.outputTokens)} ` +
          `usd=${usage.cost.toFixed(6)}`,
      );
    },
    onFailure: (failure) => {
      const detail = failure.message === undefined ? '' : ` -- ${failure.message}`;
      console.warn(`popy run failed: chat=${failure.chatId} code=${failure.code}${detail}`);
    },
  });
}

const hub = new SseHub();
// Web Push: the VAPID keys live in the secrets table, generated once.
const push = new WebPushService(context.push, context.secrets);
const updates = new NpmUpdateChecker({
  versions: readVersions(),
  now: () => systemClock.now(),
  environment: readEnvironmentVersions,
});
// The pi bridge is the only thing that can dispose a live session; the purger
// asks it to forget a chat before deleting the chat's files (popy.spec §6).
const purger = new FsChatPurger({
  workspace,
  artifactsDir,
  forgetSession: (chatId) => {
    if (bridge instanceof PiAgentBridge) bridge.forget(chatId);
  },
});
const chats = new ChatService({ chats: context.chats, clock: systemClock, purger });
const runs = new RunService({
  chats: context.chats,
  bridge,
  sink: hub,
  clock: systemClock,
  llmRuns: context.llmRuns,
  // When a run ends, tell the phone -- even with the PWA closed (popy.spec §14).
  notifyDone: (info) => {
    const chat = context.chats.get(info.chatId);
    void push
      .send({
        title: 'Popy',
        body: info.failed
          ? `${chat?.title ?? 'Your chat'}: the answer could not be finished.`
          : `${chat?.title ?? 'Your chat'}: the answer is ready.`,
        url: `/chat/${info.chatId}`,
      })
      .catch(() => undefined);
  },
  // Embed the run's new messages for semantic memory, off the reply path (§7).
  indexMessages: () => {
    void indexer?.backfill();
  },
  titles: new TitleService({
    chats: context.chats,
    gateway,
    apiKey: () => providers.apiKey(),
    serviceModel: () => settings.read().serviceModel,
    sink: hub,
    onFailure: (message) => console.warn(`popy ${message}`),
  }),
});

// Voice runs on this machine's CPU (aw's whisper.cpp flow): no tokens spent.
// The model is selected in Settings and downloaded on demand; POPY_WHISPER_MODEL
// still pins an explicit path for an operator who wants one.
const voiceModels = new WhisperModelStore(join(context.dataDir, 'voice-models'));
const transcriber = new WhisperTranscriber({
  whisperCli: process.env['POPY_WHISPER_CLI'] ?? 'whisper-cli',
  ffmpeg: process.env['POPY_FFMPEG'] ?? 'ffmpeg',
  resolveModel: () => {
    const override = process.env['POPY_WHISPER_MODEL'];
    if (override !== undefined && override.length > 0) return Promise.resolve(override);
    return voiceModels.ensure(settings.read().voiceModel);
  },
});
// The best-effort LLM pass that cleans a raw transcript (§14).
const voiceCleanup = new VoiceCleanup({
  gateway,
  apiKey: () => providers.apiKey(),
  enabled: () => settings.read().voiceCleanup,
  model: () => {
    const current = settings.read();
    return current.voiceCleanupModel.length > 0 ? current.voiceCleanupModel : current.serviceModel;
  },
});

const app = createApp({
  auth,
  settings,
  chats,
  artifacts,
  runs,
  providers,
  transcriber,
  voiceCleanup,
  voiceModels,
  userMemory: context.userMemory,
  skills: skillsVault,
  usage: context.usage,
  push,
  webauthn: new WebAuthnService({ repo: context.webauthn, now: () => systemClock.now() }),
  updates,
  backups: new TarBackupService({
    dataDir: context.dataDir,
    backupsDir: join(context.dataDir, '..', 'popy-backups'),
    now: () => new Date(systemClock.now()).toISOString(),
  }),
  hub,
  clock: systemClock,
  versions: readVersions(),
  webDist,
});

// The notify-only update channel (popy.spec §15, Vinicius 31/07): when a
// newer Popy tag appears on the origin, one push per version -- tapping it
// deep-links into Settings → Updates. Applying the update stays a shell act.
const updateNoticePath = join(context.dataDir, 'update-noticed');
async function notifyNewVersion(): Promise<void> {
  const status = await updates.status();
  const latest = status.popy.latest;
  if (latest === undefined || !isNewerVersion(status.popy.current, latest)) return;
  const noticed = ((): string => {
    try {
      return readFileSync(updateNoticePath, 'utf8').trim();
    } catch {
      return '';
    }
  })();
  if (noticed === latest) return;
  await push.send({
    title: 'Popy',
    body: `Popy ${latest} is available. Tap to open Updates.`,
    url: '/settings?section=updates',
  });
  writeFileSync(updateNoticePath, latest);
}
setTimeout(() => void notifyNewVersion().catch(() => undefined), 60_000);
setInterval(() => void notifyNewVersion().catch(() => undefined), 6 * 60 * 60 * 1000);

// A restart must not eat a half-written answer: before dying, park every
// in-flight run's partial on disk (synchronous writes, safe in a handler).
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    runs.flushInterrupted();
    process.exit(0);
  });
}

serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`popy server listening on http://${info.address}:${info.port}`);
  console.log(`popy data dir ${context.dataDir}`);
  console.log(
    agent === 'pi'
      ? `popy agent bridge: pi (real models, workspace ${workspace})`
      : 'popy agent bridge: fake (scripted; no model is contacted)',
  );
  // Catch up the embedding index for anything written before this boot, in the
  // background so nothing waits on the model download (popy.spec §7).
  if (indexer !== undefined) {
    const pending = context.embeddings.pendingCount();
    if (pending > 0) console.log(`popy embedding backfill: ${String(pending)} messages`);
    void indexer.backfill();
  }
  // Catch up the file index the same way (files stored while no embedder ran).
  void fileIndex.current?.backfill();
});
