import { Hono } from 'hono';
import type { StorageResponse } from '@pop-agent/shared';
import type { StorageService } from '../../application/storage/storage-service.js';

/**
 * Where the disk went (pop-agent.spec §14). Session-guarded: the sizes and counts
 * describe how much the owner has and how the install is laid out, which is
 * nobody else's business.
 */
export interface StorageRoutesDeps {
  storage: StorageService;
}

export function createStorageRoutes(deps: StorageRoutesDeps): Hono {
  const routes = new Hono();
  routes.get('/storage', (c) => c.json(deps.storage.report() satisfies StorageResponse));
  return routes;
}
