import { describe, expect, it, vi } from 'vitest';
import type { DeploymentRecord, DeploymentStateStore } from '../ports/deployment.js';
import type { PushService } from '../ports/push-repo.js';
import type { Timer } from '../ports/timer.js';
import type { SettingsService } from '../settings/settings-service.js';
import { AutomaticDeploymentService } from './automatic-deployment.js';
import type { DeploymentCoordinator } from './deployment-coordinator.js';

function setup() {
  let now = 0;
  let record: DeploymentRecord | undefined;
  const request = vi.fn(() => ({ ok: true as const, status: {} }));
  const cancel = vi.fn(() => true);
  const deployment = {
    reconcileExternalState: vi.fn(),
    cancelWaiting: cancel,
    status: () => ({
      pending: true,
      clean: true,
      prepared: true,
      phase: 'pending',
      headCommit: 'bbbbbbb',
    }),
    requestRestartWhenIdle: request,
  } as unknown as DeploymentCoordinator;
  const settings = {
    read: () => ({ autoActivatePreparedUpdates: true, autoRestartIdleMinutes: 10 }),
    update: vi.fn(),
  } as unknown as SettingsService;
  const state: DeploymentStateStore = {
    read: () => record,
    write: (next) => { record = next; },
  };
  const push = { send: vi.fn(async () => undefined) } as unknown as PushService;
  const timer = { every: vi.fn(() => () => undefined) } as unknown as Timer;
  const service = new AutomaticDeploymentService({
    deployment,
    state,
    settings,
    push,
    timer,
    now: () => new Date(now).toISOString(),
    nowMs: () => now,
  });
  return {
    service,
    request,
    cancel,
    advance: (ms: number) => { now += ms; },
  };
}

describe('AutomaticDeploymentService', () => {
  it('requires the complete configured quiet period', async () => {
    const h = setup();
    h.advance(9 * 60_000);
    await h.service.tick();
    expect(h.request).not.toHaveBeenCalled();

    h.advance(60_000);
    await h.service.tick();
    expect(h.request).toHaveBeenCalledWith('automatic');
  });

  it('resets and cancels an automatic wait when another message is accepted', async () => {
    const h = setup();
    h.advance(10 * 60_000);
    h.service.noteActivity();

    expect(h.cancel).toHaveBeenCalledWith('automatic');
    await h.service.tick();
    expect(h.request).not.toHaveBeenCalled();
  });
});
