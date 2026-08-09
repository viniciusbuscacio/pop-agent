import { describe, expect, it, vi } from 'vitest';
import { superviseDeployment, type DeploymentPlan } from './update-supervisor.js';

const plan: DeploymentPlan = {
  runningCommit: 'old-commit',
  targetCommit: 'new-commit',
  lastKnownGood: 'good-commit',
  repoRoot: '/repo',
  statePath: '/data/deployment-state.json',
  serviceName: 'pop-agent-test',
  healthUrl: 'http://127.0.0.1:39001/healthz',
  timeoutMs: 1_000,
  requestedBy: 'manual',
};

function harness(health: boolean[]) {
  const commands: { command: string; args: string[]; cwd?: string }[] = [];
  const records: Record<string, unknown>[] = [];
  const healthy = vi.fn().mockImplementation(() => Promise.resolve(health.shift() ?? false));
  return {
    commands,
    records,
    healthy,
    deps: {
      command: (command: string, args: string[], cwd?: string) => {
        commands.push({ command, args, ...(cwd === undefined ? {} : { cwd }) });
      },
      candidateMatches: () => true,
      healthy,
      sleep: () => Promise.resolve(),
      now: () => '2026-08-09T00:00:00.000Z',
      stamp: () => 123,
      write: (record: Record<string, unknown>) => records.push(record),
    },
  };
}

describe('update supervisor', () => {
  it('accepts the candidate only after its restarted service answers health', async () => {
    const h = harness([true]);

    await superviseDeployment(plan, h.deps);

    expect(h.commands).toEqual([
      { command: 'sudo', args: ['-n', 'systemctl', 'restart', 'pop-agent-test'] },
    ]);
    expect(h.records.at(-1)).toMatchObject({
      phase: 'healthy',
      runningCommit: 'new-commit',
      lastKnownGood: 'new-commit',
    });
  });

  it('preserves a failed candidate and restores last-known-good', async () => {
    const h = harness([false, true]);

    await superviseDeployment(plan, h.deps);

    expect(h.commands).toEqual([
      { command: 'sudo', args: ['-n', 'systemctl', 'restart', 'pop-agent-test'] },
      {
        command: 'git',
        args: ['branch', 'failed-update-new-com-123', 'new-commit'],
        cwd: '/repo',
      },
      { command: 'git', args: ['reset', '--hard', 'good-commit'], cwd: '/repo' },
      { command: 'npm', args: ['ci'], cwd: '/repo' },
      { command: 'npm', args: ['run', 'build'], cwd: '/repo' },
      { command: 'sudo', args: ['-n', 'systemctl', 'restart', 'pop-agent-test'] },
    ]);
    expect(h.records.at(-1)).toMatchObject({
      phase: 'rolled-back',
      runningCommit: 'good-commit',
      error: expect.stringContaining('did not become healthy'),
      failedRef: 'failed-update-new-com-123',
    });
  });
});
