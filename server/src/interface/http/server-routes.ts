import { Hono } from 'hono';
import type { ServerInfoResponse } from '@popy/shared';

/**
 * Settings → Server (LOTE 6). Read-only snapshot for now; the management
 * endpoints (restart/stop) join this file in the next turn.
 */
export interface ServerRoutesDeps {
  serverInfo: () => ServerInfoResponse;
}

export function createServerRoutes(deps: ServerRoutesDeps): Hono {
  const routes = new Hono();
  routes.get('/server/info', (c) => c.json(deps.serverInfo()));
  return routes;
}
