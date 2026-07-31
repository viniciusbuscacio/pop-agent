import { Hono } from 'hono';
import type { UpdateStatusResponse } from '@popy/shared';
import type { UpdateChecker } from '../../application/ports/update-checker.js';

/**
 * Update status (popy.spec §15). Read-only: it says what is installed and
 * whether a newer pi is on npm, plus the command to update. Popy does not
 * update itself from the running process; the gate runs the same suite the
 * maintainer runs before any restart.
 */
export interface UpdateRoutesDeps {
  updates: UpdateChecker;
}

export function createUpdateRoutes(deps: UpdateRoutesDeps): Hono {
  const routes = new Hono();

  routes.get('/update/status', async (c) => {
    const status = await deps.updates.status();
    const response: UpdateStatusResponse = {
      pi: {
        current: status.pi.current,
        ...(status.pi.latest === undefined ? {} : { latest: status.pi.latest }),
      },
      popy: status.popy,
      node: status.node,
      updateCommand: status.updateCommand,
    };
    return c.json(response);
  });

  return routes;
}
