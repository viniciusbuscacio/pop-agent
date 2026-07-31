import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { AuthService } from './application/auth/auth-service.js';
import { ChatService } from './application/chat/chat-service.js';
import { RunService } from './application/chat/run-service.js';
import type { AgentBridge } from './application/ports/agent-bridge.js';
import { systemClock } from './application/ports/clock.js';
import { ProviderService } from './application/providers/provider-service.js';
import { SettingsService } from './application/settings/settings-service.js';
import { FakeAgentBridge } from './infrastructure/agent/fake-bridge.js';
import { PiAgentBridge } from './infrastructure/agent/pi-bridge.js';
import { SdkPiEngine } from './infrastructure/agent/pi-engine.js';
import { Argon2PasswordHasher } from './infrastructure/auth/argon2-hasher.js';
import { bootstrap } from './infrastructure/bootstrap.js';
import { ensureWorkspace, resolveWorkspace } from './infrastructure/config/data-dir.js';
import { readVersions } from './infrastructure/config/versions.js';
import { OpenRouterGateway } from './infrastructure/providers/openrouter-gateway.js';
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
const bridge: AgentBridge = agent === 'pi' ? piBridge() : new FakeAgentBridge();

// The provider seen by the routes: key precedence (secrets over environment),
// the key test, and the model catalog with the engine's as offline fallback.
const providers = new ProviderService({
  secrets: context.secrets,
  settings: context.settings,
  gateway: new OpenRouterGateway(),
  clock: systemClock,
  envKey: () => process.env['OPENROUTER_API_KEY'],
  engineModels: () => bridge.listModels(),
});

function piBridge(): PiAgentBridge {
  return new PiAgentBridge({
    chats: context.chats,
    engine: new SdkPiEngine({
      workspace,
      sessionsDir: join(context.dataDir, 'sessions'),
      // pi's own config, credentials and catalog cache, all inside Popy's data
      // directory: a ~/.pi on the host must not reach into this process.
      agentDir: join(context.dataDir, 'pi-agent'),
      authPath: join(context.dataDir, 'pi-auth.json'),
      modelsStorePath: join(context.dataDir, 'pi-models-store.json'),
      apiKey: () => providers.apiKey(),
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
const chats = new ChatService({ chats: context.chats, clock: systemClock });
const runs = new RunService({
  chats: context.chats,
  bridge,
  sink: hub,
  clock: systemClock,
});

const app = createApp({
  auth,
  settings,
  chats,
  runs,
  providers,
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
});
