import { describe, expect, it, vi } from 'vitest';
import { DeploymentCoordinator } from '../../application/update/deployment-coordinator.js';
import { PiActivationService } from '../../application/update/pi-activation-service.js';
import { createUpdateRoutes } from './update-routes.js';

function routes() {
  let record: import('../../application/ports/deployment.js').DeploymentRecord | undefined;
  const deployment = new DeploymentCoordinator({
    runningCommit: 'aaaaaaaaaaaaaaaa',
    inspector: {
      headCommit: () => 'bbbbbbbbbbbbbbbb',
      isClean: () => true,
      isPrepared: () => true,
    },
    state: {
      read: () => record,
      write: (next) => {
        record = next;
      },
    },
    supervisor: { start: vi.fn() },
    pauseTasks: vi.fn(),
    resumeTasks: vi.fn(),
    quiesceRuns: vi.fn(),
    resumeRuns: vi.fn(),
    waitForIdle: () => new Promise<void>(() => undefined),
    now: () => '2026-08-09T00:00:00.000Z',
  });
  let candidate: import('../../application/ports/pi-candidate.js').PiCandidateStatus = {
    phase: 'ready', version: '0.85.0', integrity: 'sha512-x',
  };
  const piActivation = new PiActivationService({
    activeVersion: '0.84.1',
    state: { read: () => candidate, write: (next) => { candidate = next; } },
    supervisor: { start: vi.fn() },
    pauseTasks: vi.fn(), resumeTasks: vi.fn(), quiesceRuns: vi.fn(), resumeRuns: vi.fn(),
    waitForIdle: () => new Promise<void>(() => undefined),
    now: () => '2026-08-09T00:00:00.000Z',
  });
  return createUpdateRoutes({
    updates: {
      status: () =>
        Promise.resolve({
          pi: { current: '0.84.1', recommended: '0.84.1', latest: undefined },
          popAgent: { current: '0.2.0', latest: undefined },
          node: 'v22',
          environment: [],
          updateCommand: 'popman update',
        }),
    },
    deployment,
    piActivation,
  });
}

describe('update routes', () => {
  it('reports the running and checkout commits separately', async () => {
    const response = await routes().request('/update/status');

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      deployment: {
        runningCommit: 'aaaaaaa',
        headCommit: 'bbbbbbb',
        pending: true,
        phase: 'pending',
      },
    });
  });

  it('accepts a ready pi candidate activation without restarting inline', async () => {
    const response = await routes().request('/update/pi/activate', { method: 'POST' });

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      ok: true,
      candidate: { phase: 'waiting-idle', version: '0.85.0' },
    });
  });

  it('accepts a safe restart request without restarting inline', async () => {
    const response = await routes().request('/update/restart-when-idle', { method: 'POST' });

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      ok: true,
      deployment: { phase: 'waiting-idle' },
    });
  });
});
