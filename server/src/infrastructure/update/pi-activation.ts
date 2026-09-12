import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { userInfo } from 'node:os';
import type { PiActivationSupervisor, PiCandidateStatus } from '../../application/ports/pi-candidate.js';

export interface PiActivationPlan {
  targetVersion: string;
  integrity: string;
  previousVersion: string;
  runtimeRoot: string;
  statePath: string;
  activePath: string;
  bootPath: string;
  sessionsDir: string;
  serviceName: string;
  healthUrl: string;
  timeoutMs: number;
}

interface SupervisorDeps {
  command(command: string, args: string[]): void;
  healthy(url: string): Promise<boolean>;
  sleep(ms: number): Promise<void>;
  now(): string;
  stamp(): number;
}

/** Owns the pointer switch and rollback outside pop-agent-service's cgroup. */
export async function supervisePiActivation(plan: PiActivationPlan, deps: SupervisorDeps): Promise<void> {
  const previousPointer = readOptional(plan.activePath);
  const rollbackBase = join(plan.runtimeRoot, 'rollback');
  const rollbackRoot = join(rollbackBase, String(deps.stamp()));
  const sessionsSnapshot = join(rollbackRoot, 'sessions');
  // Keep one last-known-good snapshot; runtime updates must not grow storage forever.
  rmSync(rollbackBase, { recursive: true, force: true });
  mkdirSync(rollbackRoot, { recursive: true, mode: 0o700 });
  if (existsSync(plan.sessionsDir)) cpSync(plan.sessionsDir, sessionsSnapshot, { recursive: true });
  writeFileSync(join(rollbackRoot, 'previous-active.json'), previousPointer ?? 'null\n', { mode: 0o600 });

  try {
    atomicJson(plan.activePath, {
      version: plan.targetVersion,
      integrity: plan.integrity,
      activatedAt: deps.now(),
    });
    rmSync(plan.bootPath, { force: true });
    writeStatus(plan, { phase: 'activating', version: plan.targetVersion, integrity: plan.integrity }, deps);
    deps.command('sudo', ['-n', 'systemctl', 'restart', plan.serviceName]);
    if (!(await waitForRuntime(plan, plan.targetVersion, deps))) {
      throw new Error(`pi ${plan.targetVersion} did not pass startup health`);
    }
    writeStatus(plan, { phase: 'active', version: plan.targetVersion, integrity: plan.integrity }, deps);
  } catch (candidateError) {
    const reason = messageOf(candidateError);
    try {
      writeStatus(plan, {
        phase: 'rolling-back',
        version: plan.targetVersion,
        integrity: plan.integrity,
        error: reason,
      }, deps);
      deps.command('sudo', ['-n', 'systemctl', 'stop', plan.serviceName]);
      if (previousPointer === undefined) rmSync(plan.activePath, { force: true });
      else atomicText(plan.activePath, previousPointer);
      if (existsSync(sessionsSnapshot)) {
        rmSync(plan.sessionsDir, { recursive: true, force: true });
        mkdirSync(dirname(plan.sessionsDir), { recursive: true, mode: 0o700 });
        cpSync(sessionsSnapshot, plan.sessionsDir, { recursive: true });
      }
      rmSync(plan.bootPath, { force: true });
      deps.command('sudo', ['-n', 'systemctl', 'start', plan.serviceName]);
      if (!(await waitForRuntime(plan, plan.previousVersion, deps))) {
        throw new Error('the previous pi runtime also failed startup health');
      }
      writeStatus(plan, {
        phase: 'rolled-back',
        version: plan.targetVersion,
        integrity: plan.integrity,
        error: reason,
      }, deps);
    } catch (rollbackError) {
      writeStatus(plan, {
        phase: 'failed',
        version: plan.targetVersion,
        integrity: plan.integrity,
        error: `${reason}; rollback failed: ${messageOf(rollbackError)}`,
      }, deps);
    }
  }
}

export class DetachedPiActivationSupervisor implements PiActivationSupervisor {
  constructor(private readonly deps: Omit<PiActivationPlan, 'targetVersion' | 'integrity' | 'previousVersion'> & { scriptPath: string }) {}

  start(plan: { targetVersion: string; integrity: string; previousVersion: string }): void {
    const planPath = join(this.deps.runtimeRoot, 'activation-plan.json');
    const { scriptPath, ...runtimeDeps } = this.deps;
    atomicJson(planPath, { ...runtimeDeps, ...plan });
    const unit = `pop-agent-pi-${String(process.pid)}-${String(Date.now())}`;
    execFileSync(
      'sudo',
      [
        '-n', 'systemd-run', '--quiet', '--collect', `--unit=${unit}`,
        '--property=Type=exec', `--property=User=${userInfo().username}`,
        process.execPath, scriptPath, planPath,
      ],
      { stdio: 'ignore' },
    );
  }
}

async function waitForRuntime(plan: PiActivationPlan, version: string, deps: SupervisorDeps): Promise<boolean> {
  const attempts = Math.max(1, Math.ceil(plan.timeoutMs / 1_000));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await deps.sleep(1_000);
    if (await deps.healthy(plan.healthUrl) && bootVersion(plan.bootPath) === version) return true;
  }
  return false;
}

function bootVersion(path: string): string | undefined {
  try {
    return (JSON.parse(readFileSync(path, 'utf8')) as { version?: string }).version;
  } catch {
    return undefined;
  }
}

function writeStatus(plan: PiActivationPlan, status: PiCandidateStatus, deps: SupervisorDeps): void {
  atomicJson(plan.statePath, { ...status, updatedAt: deps.now() });
}

function readOptional(path: string): string | undefined {
  try { return readFileSync(path, 'utf8'); } catch { return undefined; }
}

function atomicJson(path: string, value: unknown): void {
  atomicText(path, `${JSON.stringify(value, null, 2)}\n`);
}

function atomicText(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${String(process.pid)}.tmp`;
  writeFileSync(temporary, value, { mode: 0o600 });
  renameSync(temporary, path);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function realDeps(): SupervisorDeps {
  return {
    command: (command, args) => execFileSync(command, args, { stdio: 'ignore', timeout: 120_000 }),
    healthy: async (url) => {
      try {
        return (await fetch(url, { signal: AbortSignal.timeout(2_000) })).ok;
      } catch {
        return false;
      }
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => new Date().toISOString(),
    stamp: () => Date.now(),
  };
}

async function main(): Promise<void> {
  const planPath = process.argv[2];
  if (planPath === undefined) throw new Error('pi activation plan path is required');
  const plan = JSON.parse(readFileSync(planPath, 'utf8')) as PiActivationPlan;
  try {
    await supervisePiActivation(plan, realDeps());
  } finally {
    try { unlinkSync(planPath); } catch { /* one-shot plan */ }
  }
}

if (process.argv[1]?.endsWith('pi-activation.js') === true) {
  void main().catch((error: unknown) => {
    console.error(`pop pi activation supervisor: ${messageOf(error)}`);
    process.exitCode = 1;
  });
}
