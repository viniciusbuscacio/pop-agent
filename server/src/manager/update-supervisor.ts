#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';

export interface DeploymentPlan {
  runningCommit: string;
  targetCommit: string;
  lastKnownGood: string;
  repoRoot: string;
  statePath: string;
  serviceName: string;
  healthUrl: string;
  timeoutMs: number;
}

interface SupervisorDeps {
  command(command: string, args: string[], cwd?: string): void;
  healthy(url: string): Promise<boolean>;
  sleep(ms: number): Promise<void>;
  now(): string;
  stamp(): number;
  write(record: Record<string, unknown>): void;
}

/**
 * Runs outside pop-agent-service's cgroup. It is intentionally dependency-free:
 * even a candidate with a broken node_modules must still be able to put the
 * last-known-good checkout back and restart it.
 */
export async function superviseDeployment(plan: DeploymentPlan, deps: SupervisorDeps): Promise<void> {
  const common = {
    targetCommit: plan.targetCommit,
    lastKnownGood: plan.lastKnownGood,
  };
  try {
    deps.write({
      ...common,
      phase: 'restarting',
      runningCommit: plan.runningCommit,
      updatedAt: deps.now(),
    });
    deps.command('sudo', ['-n', 'systemctl', 'restart', plan.serviceName]);
    if (!(await waitForHealth(plan.healthUrl, plan.timeoutMs, deps))) {
      throw new Error(`The candidate did not become healthy within ${String(plan.timeoutMs)} ms`);
    }
    deps.write({
      ...common,
      phase: 'healthy',
      runningCommit: plan.targetCommit,
      lastKnownGood: plan.targetCommit,
      updatedAt: deps.now(),
    });
  } catch (candidateError) {
    const reason = messageOf(candidateError);
    const failedRef = `failed-update-${plan.targetCommit.slice(0, 7)}-${String(deps.stamp())}`;
    try {
      deps.write({
        ...common,
        phase: 'rolling-back',
        runningCommit: plan.runningCommit,
        updatedAt: deps.now(),
        error: reason,
        failedRef,
      });
      // Preserve every candidate commit before moving the checked-out branch.
      deps.command('git', ['branch', failedRef, plan.targetCommit], plan.repoRoot);
      deps.command('git', ['reset', '--hard', plan.lastKnownGood], plan.repoRoot);
      deps.command('npm', ['ci'], plan.repoRoot);
      deps.command('npm', ['run', 'build'], plan.repoRoot);
      deps.command('sudo', ['-n', 'systemctl', 'restart', plan.serviceName]);
      if (!(await waitForHealth(plan.healthUrl, plan.timeoutMs, deps))) {
        throw new Error('The last-known-good checkout also failed its health check');
      }
      deps.write({
        ...common,
        phase: 'rolled-back',
        runningCommit: plan.lastKnownGood,
        updatedAt: deps.now(),
        error: reason,
        failedRef,
      });
    } catch (rollbackError) {
      deps.write({
        ...common,
        phase: 'failed',
        runningCommit: plan.runningCommit,
        updatedAt: deps.now(),
        error: `${reason}; rollback failed: ${messageOf(rollbackError)}`,
        failedRef,
      });
    }
  }
}

async function waitForHealth(url: string, timeoutMs: number, deps: SupervisorDeps): Promise<boolean> {
  const attempts = Math.max(1, Math.ceil(timeoutMs / 1_000));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await deps.sleep(1_000);
    if (await deps.healthy(url)) return true;
  }
  return false;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function atomicWrite(path: string, record: Record<string, unknown>): void {
  const temporary = `${path}.${String(process.pid)}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
}

function realDeps(plan: DeploymentPlan): SupervisorDeps {
  return {
    command: (command, args, cwd) => {
      execFileSync(command, args, {
        ...(cwd === undefined ? {} : { cwd }),
        stdio: 'ignore',
        timeout: 10 * 60 * 1000,
      });
    },
    healthy: async (url) => {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
        return response.ok;
      } catch {
        return false;
      }
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => new Date().toISOString(),
    stamp: () => Date.now(),
    write: (record) => atomicWrite(plan.statePath, record),
  };
}

async function main(): Promise<void> {
  const planPath = process.argv[2];
  if (planPath === undefined) throw new Error('deployment plan path is required');
  const plan = JSON.parse(readFileSync(planPath, 'utf8')) as DeploymentPlan;
  try {
    await superviseDeployment(plan, realDeps(plan));
  } finally {
    try {
      unlinkSync(planPath);
    } catch {
      // The state file carries the result; a missing one-shot plan is harmless.
    }
  }
}

if (process.argv[1]?.endsWith('update-supervisor.js') === true) {
  void main().catch((error: unknown) => {
    console.error(`pop deployment supervisor: ${messageOf(error)}`);
    process.exitCode = 1;
  });
}
