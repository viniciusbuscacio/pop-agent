import { describe, expect, it, vi } from 'vitest';
import type { DeploymentRecord } from '../ports/deployment.js';
import { DeploymentCoordinator } from './deployment-coordinator.js';

function harness(options: { running?: string; head?: string; clean?: boolean; prepared?: boolean } = {}) {
  let record: DeploymentRecord | undefined;
  let head = options.head ?? 'bbbbbbbbbbbbbbbb';
  let resolveIdle = (): void => undefined;
  let idle = new Promise<void>((resolve) => { resolveIdle = resolve; });
  const supervisor = vi.fn();
  const pauseTasks = vi.fn();
  const resumeTasks = vi.fn();
  const quiesceRuns = vi.fn();
  const resumeRuns = vi.fn();
  const coordinator = new DeploymentCoordinator({
    runningCommit: options.running ?? 'aaaaaaaaaaaaaaaa',
    inspector: {
      headCommit: () => head,
      isClean: () => options.clean ?? true,
      isPrepared: () => options.prepared ?? true,
    },
    state: {
      read: () => record,
      write: (next) => { record = next; },
    },
    supervisor: { start: supervisor },
    pauseTasks,
    resumeTasks,
    quiesceRuns,
    resumeRuns,
    waitForIdle: () => idle,
    now: () => '2026-08-09T00:00:00.000Z',
  });
  return {
    coordinator, supervisor, pauseTasks, resumeTasks, quiesceRuns, resumeRuns,
    resolveIdle,
    nextIdle: () => { idle = new Promise<void>((resolve) => { resolveIdle = resolve; }); },
    resolve: () => resolveIdle(),
    setHead: (value: string) => { head = value; },
    record: () => record,
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('DeploymentCoordinator', () => {
  it('reports whether HEAD has an exact green-gate receipt', () => {
    expect(harness({ prepared: false }).coordinator.status()).toMatchObject({
      pending: true, clean: true, prepared: false, phase: 'pending',
    });
  });

  it('requires preparation only for automatic activation', () => {
    const h = harness({ prepared: false });
    expect(h.coordinator.requestRestartWhenIdle('automatic')).toEqual({ ok: false, reason: 'not_prepared' });
    expect(h.coordinator.requestRestartWhenIdle('manual')).toMatchObject({ ok: true });
  });

  it('waits passively, then closes task and run admission before hand-off', async () => {
    const h = harness();
    expect(h.coordinator.requestRestartWhenIdle('automatic')).toMatchObject({ ok: true });
    expect(h.quiesceRuns).not.toHaveBeenCalled();

    h.resolve();
    await flush();

    expect(h.pauseTasks).toHaveBeenCalledOnce();
    expect(h.quiesceRuns).toHaveBeenCalledOnce();
    expect(h.supervisor).toHaveBeenCalledWith({
      runningCommit: 'aaaaaaaaaaaaaaaa', targetCommit: 'bbbbbbbbbbbbbbbb',
      lastKnownGood: 'aaaaaaaaaaaaaaaa', requestedBy: 'automatic',
    });
  });

  it('reopens admission instead of activating a checkout that changed during the wait', async () => {
    const h = harness();
    h.coordinator.requestRestartWhenIdle('automatic');
    h.setHead('cccccccccccccccc');
    h.resolve();
    await flush();

    expect(h.supervisor).not.toHaveBeenCalled();
    expect(h.resumeRuns).toHaveBeenCalledOnce();
    expect(h.resumeTasks).toHaveBeenCalledOnce();
    expect(h.record()).toMatchObject({ phase: 'superseded' });
  });

  it('can cancel an automatic wait without changing the operator LLM switch', () => {
    const h = harness();
    h.coordinator.requestRestartWhenIdle('automatic');

    expect(h.coordinator.cancelWaiting('automatic')).toBe(true);
    expect(h.resumeRuns).toHaveBeenCalledOnce();
    expect(h.resumeTasks).toHaveBeenCalledOnce();
    expect(h.record()).toMatchObject({ phase: 'cancelled' });
  });
});
