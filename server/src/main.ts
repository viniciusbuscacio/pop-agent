import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { AuthService } from './application/auth/auth-service.js';
import { ChatService } from './application/chat/chat-service.js';
import { RunService } from './application/chat/run-service.js';
import { systemClock } from './application/ports/clock.js';
import { SettingsService } from './application/settings/settings-service.js';
import { FakeAgentBridge } from './infrastructure/agent/fake-bridge.js';
import { Argon2PasswordHasher } from './infrastructure/auth/argon2-hasher.js';
import { bootstrap } from './infrastructure/bootstrap.js';
import { readVersions } from './infrastructure/config/versions.js';
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

// `POPY_AGENT=pi` is reserved for Phase 3; until the adapter exists, saying so
// out loud beats booting with a fake the operator did not ask for.
if (process.env['POPY_AGENT'] === 'pi') {
  throw new Error('POPY_AGENT=pi is not available yet: the pi bridge arrives in Phase 3');
}
const bridge = new FakeAgentBridge();

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
  settings: new SettingsService(context.settings),
  chats,
  runs,
  bridge,
  hub,
  clock: systemClock,
  versions: readVersions(),
  webDist,
});

serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`popy server listening on http://${info.address}:${info.port}`);
  console.log(`popy data dir ${context.dataDir}`);
  console.log('popy agent bridge: fake (scripted; no model is contacted)');
});
