import { Hono } from 'hono';
import type { UpdateStatusResponse } from '@pop-agent/shared';
import type { UpdateChecker } from '../../application/ports/update-checker.js';

/**
 * Update status (pop-agent.spec §15). Read-only: it says what is installed and
 * whether a newer pi is on npm, plus the command to update. Pop Agent does not
 * update itself from the running process; the gate runs the same suite the
 * maintainer runs before any restart.
 */
export interface UpdateRoutesDeps {
  updates: UpdateChecker;
}

export function createUpdateRoutes(deps: UpdateRoutesDeps): Hono {
  const routes = new Hono();

  routes.get('/update/status', async (c) => {
    const refresh = c.req.query('refresh') === '1';
    const status = await deps.updates.status({ refresh });
    const response: UpdateStatusResponse = {
      pi: {
        current: status.pi.current,
        ...(status.pi.latest === undefined ? {} : { latest: status.pi.latest }),
      },
      popAgent: {
        current: status.popAgent.current,
        ...(status.popAgent.latest === undefined ? {} : { latest: status.popAgent.latest }),
      },
      node: status.node,
      environment: status.environment,
      updateCommand: status.updateCommand,
    };
    return c.json(response);
  });

  return routes;
}
