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
import { PiAgentBridge } from './infrastructure/agent/pi-bridge.js';
import { SdkPiEngine } from './infrastructure/agent/pi-engine.js';
import { NotesVault } from './infrastructure/notes/notes-vault.js';
import { SkillsVault } from './infrastructure/skills/skills-vault.js';
import { TransformersEmbedder } from './infrastructure/embeddings/transformers-embedder.js';
import { HybridMemory } from './application/memory/hybrid-memory.js';
import { EmbeddingIndexer } from './application/memory/embedding-indexer.js';
import { SkillRouterService } from './application/skills/skill-router-service.js';
import { Argon2PasswordHasher } from './infrastructure/auth/argon2-hasher.js';
import { bootstrap } from './infrastructure/bootstrap.js';
import { ensureWorkspace, resolveWorkspace } from './infrastructure/config/data-dir.js';
import { readVersions } from './infrastructure/config/versions.js';
import { TarBackupService } from './infrastructure/backup/tar-backup-service.js';
import { OpenRouterGateway } from './infrastructure/providers/openrouter-gateway.js';
import { WebPushService } from './infrastructure/push/web-push-service.js';
import { WebAuthnService } from './infrastructure/auth/webauthn-service.js';
import { NpmUpdateChecker } from './infrastructure/update/npm-update-checker.js';
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
const skillRouter = new SkillRouterService(skillsVault, embedder);
const indexer =
  embedder === undefined
    ? undefined
    : new EmbeddingIndexer({
        embeddings: context.embeddings,
        embedder,
        onError: (message) => console.warn(`popy embedding: ${message}`),
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
    }),
    defaultModelId: () => settings.read().defaultModel,
    instructions: () => settings.read().customInstructions,
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
// The pi bridge is the only thing that can dispose a live session; the purger
// asks it to forget a chat before deleting the chat's files (popy.spec §6).
const purger = new FsChatPurger({
  workspace,
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
const transcriber = new WhisperTranscriber({
  whisperCli: process.env['POPY_WHISPER_CLI'] ?? 'whisper-cli',
  ffmpeg: process.env['POPY_FFMPEG'] ?? 'ffmpeg',
  modelPath: process.env['POPY_WHISPER_MODEL'],
});

const app = createApp({
  auth,
  settings,
  chats,
  runs,
  providers,
  transcriber,
  userMemory: context.userMemory,
  skills: skillsVault,
  usage: context.usage,
  push,
  webauthn: new WebAuthnService({ repo: context.webauthn, now: () => systemClock.now() }),
  updates: new NpmUpdateChecker({ versions: readVersions(), now: () => systemClock.now() }),
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
});
