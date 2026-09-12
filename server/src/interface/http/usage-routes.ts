import { Hono } from 'hono';
import type { UsageResponse } from '@pop-agent/shared';
import type { UsageRepo } from '../../application/ports/usage-repo.js';

/** The cost dashboard (docs/specs/Spec-Pop-General.md §14), read straight off the llm_runs table. */
export interface UsageRoutesDeps {
  usage: UsageRepo;
}

export function createUsageRoutes(deps: UsageRoutesDeps): Hono {
  const routes = new Hono();
  routes.get('/usage', (c) => c.json(deps.usage.report() satisfies UsageResponse));
  return routes;
}
