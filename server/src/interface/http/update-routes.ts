import { Hono } from 'hono';
import type {
  DeploymentCancelResponse,
  DeploymentRequestResponse,
  PiCandidateActivateResponse,
  PiCandidatePrepareResponse,
  UpdateStatusResponse,
} from '@pop-agent/shared';
import type { UpdateChecker } from '../../application/ports/update-checker.js';
import type { DeploymentCoordinator } from '../../application/update/deployment-coordinator.js';
import type { PiCandidateService } from '../../application/update/pi-candidate-service.js';
import type { PiActivationService } from '../../application/update/pi-activation-service.js';

/**
 * Update status and safe activation (docs/specs/Spec-Pop-General.md §15). The running process
 * never restarts itself: it drains work and hands a committed checkout to an
 * external transient unit, which owns health validation and rollback.
 */
export interface UpdateRoutesDeps {
  updates: UpdateChecker;
  deployment?: DeploymentCoordinator;
  piCandidates?: PiCandidateService;
  piActivation?: PiActivationService;
}

export function createUpdateRoutes(deps: UpdateRoutesDeps): Hono {
  const routes = new Hono();

  routes.get('/update/status', async (c) => {
    const refresh = c.req.query('refresh') === '1';
    const status = await deps.updates.status({ refresh });
    const response: UpdateStatusResponse = {
      pi: {
        current: status.pi.current,
        recommended: status.pi.recommended,
        ...(status.pi.latest === undefined ? {} : { latest: status.pi.latest }),
        ...(deps.piCandidates === undefined ? {} : { candidate: deps.piCandidates.status() }),
      },
      popAgent: {
        current: status.popAgent.current,
        ...(status.popAgent.latest === undefined ? {} : { latest: status.popAgent.latest }),
      },
      node: status.node,
      environment: status.environment,
      updateCommand: status.updateCommand,
      ...(deps.deployment === undefined ? {} : { deployment: deps.deployment.status() }),
    };
    return c.json(response);
  });

  routes.post('/update/pi/prepare', async (c) => {
    if (deps.piCandidates === undefined) {
      return c.json({ ok: false, reason: 'target_unavailable' } satisfies PiCandidatePrepareResponse, 503);
    }
    const result = await deps.piCandidates.prepare();
    if (!result.ok) return c.json(result satisfies PiCandidatePrepareResponse, 409);
    return c.json({ ok: true, candidate: result.status } satisfies PiCandidatePrepareResponse, 202);
  });

  routes.post('/update/pi/activate', (c) => {
    if (deps.piActivation === undefined) {
      return c.json({ ok: false, reason: 'candidate_not_ready' } satisfies PiCandidateActivateResponse, 503);
    }
    const result = deps.piActivation.request();
    if (!result.ok) return c.json(result satisfies PiCandidateActivateResponse, 409);
    return c.json({ ok: true, candidate: result.status } satisfies PiCandidateActivateResponse, 202);
  });

  routes.post('/update/restart-when-idle', (c) => {
    if (deps.deployment === undefined) {
      return c.json(
        { ok: false, reason: 'already_current' } satisfies DeploymentRequestResponse,
        409,
      );
    }
    const result = deps.deployment.requestRestartWhenIdle();
    if (!result.ok) return c.json(result satisfies DeploymentRequestResponse, 409);
    return c.json(
      { ok: true, deployment: result.status } satisfies DeploymentRequestResponse,
      202,
    );
  });

  routes.post('/update/cancel', (c) => {
    if (deps.deployment?.cancelWaiting() !== true) {
      return c.json({ ok: false, reason: 'not_waiting' } satisfies DeploymentCancelResponse, 409);
    }
    return c.json({ ok: true } satisfies DeploymentCancelResponse);
  });

  return routes;
}
