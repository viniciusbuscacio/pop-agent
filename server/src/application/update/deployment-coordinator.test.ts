import { describe, expect, it, vi } from 'vitest';
import type { DeploymentRecord } from '../ports/deployment.js';
import { DeploymentCoordinator } from './deployment-coordinator.js';

function harness(options: { running?: string; head?: string; clean?: boolean } = {}) {
  let record: DeploymentRecord | undefined;
  let resolveIdle = (): void => undefined;
  const idle = new Promise<void>((resolve) => {
    resolveIdle = resolve;
  });
  const supervisor = vi.fn();
  const quiesce = vi.fn();
  const resume = vi.fn();
  const coordinator = new DeploymentCoordinator({
    runningCommit: options.running ?? 'aaaaaaaaaaaaaaaa',
    inspector: {
      headCommit: () => options.head ?? 'bbbbbbbbbbbbbbbb',
      isClean: () => options.clean ?? true,
    },
    state: {
      read: () => record,
      write: (next) => {
        record = next;
      },
    },
    supervisor: { start: supervisor },
    quiesce,
    resume,
    waitForIdle: () => idle,
    now: () => '2026-08-09T00:00:00.000Z',
  });
  return { coordinator, supervisor, quiesce, resume, resolveIdle, record: () => record };
}

describe('DeploymentCoordinator', () => {
  it('distinguishes the boot commit from the checkout HEAD', () => {
    const { coordinator } = harness();

    expect(coordinator.status()).toMatchObject({
      runningCommit: 'aaaaaaa',
      headCommit: 'bbbbbbb',
      lastKnownGood: 'aaaaaaa',
      pending: true,
      clean: true,
      phase: 'pending',
    });
  });

  it('refuses an uncommitted checkout', () => {
    const { coordinator, quiesce } = harness({ clean: false });

    expect(coordinator.requestRestartWhenIdle()).toEqual({ ok: false, reason: 'dirty_tree' });
    expect(quiesce).not.toHaveBeenCalled();
  });

  it('quiesces new runs and hands off only after all active work drains', async () => {
    const { coordinator, quiesce, supervisor, resolveIdle, record } = harness();

    expect(coordinator.requestRestartWhenIdle()).toMatchObject({ ok: true });
    expect(quiesce).toHaveBeenCalledOnce();
    expect(record()?.phase).toBe('waiting-idle');
    expect(supervisor).not.toHaveBeenCalled();

    resolveIdle();
    await Promise.resolve();
    await Promise.resolve();

    expect(record()?.phase).toBe('restarting');
    expect(supervisor).toHaveBeenCalledWith({
      runningCommit: 'aaaaaaaaaaaaaaaa',
      targetCommit: 'bbbbbbbbbbbbbbbb',
      lastKnownGood: 'aaaaaaaaaaaaaaaa',
    });
  });

  it('reopens the run gate when the external hand-off fails', async () => {
    const { coordinator, supervisor, resume, resolveIdle, record } = harness();
    supervisor.mockImplementation(() => {
      throw new Error('systemd-run denied');
    });

    coordinator.requestRestartWhenIdle();
    resolveIdle();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(resume).toHaveBeenCalledOnce();
    expect(record()).toMatchObject({ phase: 'failed', error: 'systemd-run denied' });
  });
});
