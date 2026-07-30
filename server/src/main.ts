import { serve } from '@hono/node-server';
import { bootstrap } from './infrastructure/bootstrap.js';
import { createApp } from './interface/http/app.js';

const port = Number(process.env['POPY_PORT'] ?? 8787);
const hostname = process.env['POPY_BIND'] ?? '127.0.0.1';

const context = bootstrap();
const app = createApp();

serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`popy server listening on http://${info.address}:${info.port}`);
  console.log(`popy data dir ${context.dataDir}`);
});
