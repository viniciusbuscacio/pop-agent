import { Hono } from 'hono';
import type { ServerInfoResponse } from '@popy/shared';

/**
 * Settings → Server (LOTE 6). The info snapshot is read-only; the danger
 * zone endpoints act on the service and the LLM runtime. All four actions
 * are immediate and irreversible from the client's side -- the UI confirms
 * before calling, the endpoint does not negotiate.
 */
export interface ServerRoutesDeps {
  serverInfo: () => ServerInfoResponse;
  serverControl: {
    /** Schedules a systemd restart of the whole service. */
    restart(): void;
    /** Schedules a systemd stop. The web dies with it; only SSH brings it back. */
    stop(): void;
    /** Aborts live runs and refuses new ones. Returns how many were interrupted. */
    llmStop(): number;
    /** Clears the stop flag and drops live sessions so they rebuild fresh. */
    llmStart(): void;
  };
}

export function createServerRoutes(deps: ServerRoutesDeps): Hono {
  const routes = new Hono();

  routes.get('/server/info', (c) => c.json(deps.serverInfo()));

  routes.post('/server/restart', (c) => {
    deps.serverControl.restart();
    return c.json({ ok: true, action: 'restart' });
  });

  routes.post('/server/stop', (c) => {
    deps.serverControl.stop();
    return c.json({ ok: true, action: 'stop' });
  });

  routes.post('/server/llm-stop', (c) => {
    const interrupted = deps.serverControl.llmStop();
    return c.json({ ok: true, action: 'llm-stop', interrupted });
  });

  routes.post('/server/llm-start', (c) => {
    deps.serverControl.llmStart();
    return c.json({ ok: true, action: 'llm-start' });
  });

  return routes;
}
