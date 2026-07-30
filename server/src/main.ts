import { serve } from '@hono/node-server';
import { AuthService } from './application/auth/auth-service.js';
import { systemClock } from './application/ports/clock.js';
import { SettingsService } from './application/settings/settings-service.js';
import { Argon2PasswordHasher } from './infrastructure/auth/argon2-hasher.js';
import { bootstrap } from './infrastructure/bootstrap.js';
import { readVersions } from './infrastructure/config/versions.js';
import { createApp } from './interface/http/app.js';

const port = Number(process.env['POPY_PORT'] ?? 8787);
const hostname = process.env['POPY_BIND'] ?? '127.0.0.1';

// Composition root: the one place that knows every layer (popy.spec §3).
const context = bootstrap();
const auth = new AuthService({
  settings: context.settings,
  secrets: context.secrets,
  hasher: new Argon2PasswordHasher(),
  clock: systemClock,
});

const app = createApp({
  auth,
  settings: new SettingsService(context.settings),
  clock: systemClock,
  versions: readVersions(),
});

serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`popy server listening on http://${info.address}:${info.port}`);
  console.log(`popy data dir ${context.dataDir}`);
});
