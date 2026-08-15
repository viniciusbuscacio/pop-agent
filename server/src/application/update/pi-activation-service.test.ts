import { describe, expect, it, vi } from 'vitest';
import { PiActivationService } from './pi-activation-service.js';
import type { PiCandidateStatus } from '../ports/pi-candidate.js';

function harness(initial: PiCandidateStatus = { phase: 'ready', version: '0.85.0', integrity: 'sha512-x' }) {
  let state = initial;
  let releaseIdle!: () => void;
  const idle = new Promise<void>((resolve) => { releaseIdle = resolve; });
  const start = vi.fn();
  const pauseTasks = vi.fn();
  const resumeTasks = vi.fn();
  const quiesceRuns = vi.fn();
  const resumeRuns = vi.fn();
  const service = new PiActivationService({
    activeVersion: '0.84.1',
    state: { read: () => state, write: (next) => { state = next; } },
    supervisor: { start },
    pauseTasks,
    resumeTasks,
    quiesceRuns,
    resumeRuns,
    waitForIdle: () => idle,
    now: () => '2026-08-15T00:00:00.000Z',
  });
  return { service, state: () => state, releaseIdle, start, pauseTasks, quiesceRuns };
}

describe('PiActivationService', () => {
  it('waits for idle, closes admission, and hands the exact validated candidate outside', async () => {
    const h = harness();
    expect(h.service.request()).toMatchObject({ ok: true, status: { phase: 'waiting-idle' } });
    expect(h.start).not.toHaveBeenCalled();
    h.releaseIdle();
    await vi.waitFor(() => expect(h.start).toHaveBeenCalledWith({
      targetVersion: '0.85.0', integrity: 'sha512-x', previousVersion: '0.84.1',
    }));
    expect(h.pauseTasks).toHaveBeenCalledOnce();
    expect(h.quiesceRuns).toHaveBeenCalledOnce();
    expect(h.state().phase).toBe('activating');
  });

  it('refuses activation without a ready different candidate', () => {
    expect(harness({ phase: 'idle' }).service.request()).toEqual({ ok: false, reason: 'candidate_not_ready' });
    expect(harness({ phase: 'ready', version: '0.84.1', integrity: 'x' }).service.request())
      .toEqual({ ok: false, reason: 'already_current' });
  });
});
