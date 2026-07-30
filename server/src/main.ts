import { serve } from '@hono/node-server';
import { createApp } from './interface/http/app.js';

const port = Number(process.env['POPY_PORT'] ?? 3999);
const hostname = process.env['POPY_BIND'] ?? '127.0.0.1';

const app = createApp();

serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`popy server listening on http://${info.address}:${info.port}`);
});
