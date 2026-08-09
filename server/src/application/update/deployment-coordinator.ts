import type {
  DeploymentInspector,
  DeploymentRequester,
  DeploymentStateStore,
  DeploymentStatus,
  DeploymentSupervisor,
} from '../ports/deployment.js';

export type DeploymentRequestResult =
  | { ok: true; status: DeploymentStatus }
  | {
      ok: false;
      reason:
        | 'already_current'
        | 'dirty_tree'
        | 'not_prepared'
        | 'already_scheduled';
    };

interface ScheduledDeployment {
  targetCommit: string;
  requestedBy: DeploymentRequester;
  cancelled: boolean;
}

/**
 * Waits without disrupting active use, then closes chat/task admission and
 * hands the exact committed candidate to a supervisor outside this process.
 */
export class DeploymentCoordinator {
  private scheduled: ScheduledDeployment | undefined;
  /** Exposed for idle-tracker coupling. */
  public get runs() { return this.deps.runs; }
  public get tasks() { return this.deps.taskScheduler; }

  constructor(
    private readonly deps: {
      runningCommit: string;
      inspector: DeploymentInspector;
      state: DeploymentStateStore;
      supervisor: DeploymentSupervisor;
      pauseTasks: () => void;
      resumeTasks: () => void;
      quiesceRuns: () => void;
      resumeRuns: () => void;
      waitForIdle: () => Promise<void>;
      now: () => string;
    },
  ) {
    this.reconcileBoot();
  }

  status(): DeploymentStatus {
    const headCommit = this.deps.inspector.headCommit();
    const pending = headCommit !== this.deps.runningCommit;
    const clean = this.deps.inspector.isClean();
    const prepared = clean && this.deps.inspector.isPrepared(headCommit);
    const record = this.deps.state.read();
    const lastKnownGood = record?.lastKnownGood ?? this.deps.runningCommit;
    const relevant = record !== undefined && record.targetCommit === headCommit;
    const terminal = record?.phase === 'rolled-back' || record?.phase === 'failed';
    const phase = this.scheduled !== undefined
      ? 'waiting-idle'
      : pending
        ? relevant && record.phase !== 'healthy'
          ? record.phase
          : 'pending'
        : relevant || terminal
          ? record?.phase ?? 'current'
          : 'current';

    return {
      runningCommit: short(this.deps.runningCommit),
      headCommit: short(headCommit),
      lastKnownGood: short(lastKnownGood),
      pending,
      clean,
      prepared,
      phase,
      ...(record?.requestedBy === undefined ? {} : { requestedBy: record.requestedBy }),
      ...((relevant || terminal) && record?.error !== undefined ? { error: record.error } : {}),
      ...((relevant || terminal) && record?.failedRef !== undefined
        ? { failedRef: record.failedRef }
        : {}),
    };
  }

  requestRestartWhenIdle(requestedBy: DeploymentRequester = 'manual'): DeploymentRequestResult {
    const status = this.status();
    if (!status.pending) return { ok: false, reason: 'already_current' };
    if (!status.clean) return { ok: false, reason: 'dirty_tree' };
    if (requestedBy === 'automatic' && !status.prepared) {
      return { ok: false, reason: 'not_prepared' };
    }
    if (
      this.scheduled !== undefined ||
      status.phase === 'waiting-idle' ||
      status.phase === 'restarting' ||
      status.phase === 'rolling-back'
    ) {
      return { ok: false, reason: 'already_scheduled' };
    }

    const runningCommit = this.deps.runningCommit;
    const targetCommit = this.deps.inspector.headCommit();
    const previous = this.deps.state.read();
    const lastKnownGood = previous?.lastKnownGood ?? runningCommit;
    const requestedAt = this.deps.now();
    const scheduled: ScheduledDeployment = { targetCommit, requestedBy, cancelled: false };
    this.scheduled = scheduled;
    this.deps.state.write({
      phase: 'waiting-idle',
      runningCommit,
      targetCommit,
      lastKnownGood,
      requestedBy,
      requestedAt,
      updatedAt: requestedAt,
    });

    void this.drainAndHandOff(scheduled, { runningCommit, targetCommit, lastKnownGood, requestedAt });
    return { ok: true, status: this.status() };
  }

  /** Reopens admission if the external supervisor rejected the candidate before restart. */
  reconcileExternalState(): void {
    if (this.scheduled === undefined) return;
    const phase = this.deps.state.read()?.phase;
    if (phase === 'superseded' || phase === 'failed' || phase === 'cancelled') {
      this.scheduled = undefined;
      this.reopenAdmission();
    }
  }

  /** Cancels only while this process still owns the wait; a launched supervisor is final. */
  cancelWaiting(requestedBy?: DeploymentRequester): boolean {
    const scheduled = this.scheduled;
    if (scheduled === undefined || (requestedBy !== undefined && scheduled.requestedBy !== requestedBy)) {
      return false;
    }
    scheduled.cancelled = true;
    this.scheduled = undefined;
    this.reopenAdmission();
    const previous = this.deps.state.read();
    const now = this.deps.now();
    this.deps.state.write({
      phase: 'cancelled',
      runningCommit: this.deps.runningCommit,
      targetCommit: scheduled.targetCommit,
      lastKnownGood: previous?.lastKnownGood ?? this.deps.runningCommit,
      requestedBy: scheduled.requestedBy,
      requestedAt: previous?.requestedAt,
      updatedAt: now,
    });
    return true;
  }

  private async drainAndHandOff(
    scheduled: ScheduledDeployment,
    plan: { runningCommit: string; targetCommit: string; lastKnownGood: string; requestedAt: string },
  ): Promise<void> {
    try {
      // Passive wait first: a long answer must not make the whole agent refuse work.
      await this.deps.waitForIdle();
      if (scheduled.cancelled || this.scheduled !== scheduled) return;

      // JavaScript runs these synchronously, forming the admission barrier.
      this.deps.pauseTasks();
      this.deps.quiesceRuns();
      await this.deps.waitForIdle();
      if (scheduled.cancelled || this.scheduled !== scheduled) return;

      const currentHead = this.deps.inspector.headCommit();
      const valid =
        currentHead === plan.targetCommit &&
        this.deps.inspector.isClean() &&
        (scheduled.requestedBy === 'manual' || this.deps.inspector.isPrepared(currentHead));
      if (!valid) {
        this.scheduled = undefined;
        this.reopenAdmission();
        this.deps.state.write({
          phase: 'superseded',
          ...plan,
          requestedBy: scheduled.requestedBy,
          updatedAt: this.deps.now(),
          error: 'The prepared checkout changed before activation.',
        });
        return;
      }

      this.deps.state.write({
        phase: 'restarting',
        ...plan,
        requestedBy: scheduled.requestedBy,
        updatedAt: this.deps.now(),
      });
      this.deps.supervisor.start({
        runningCommit: plan.runningCommit,
        targetCommit: plan.targetCommit,
        lastKnownGood: plan.lastKnownGood,
        requestedBy: scheduled.requestedBy,
      });
    } catch (error: unknown) {
      this.scheduled = undefined;
      this.reopenAdmission();
      this.deps.state.write({
        phase: 'failed',
        ...plan,
        requestedBy: scheduled.requestedBy,
        updatedAt: this.deps.now(),
        error: error instanceof Error ? error.message : 'Could not schedule deployment',
      });
    }
  }

  private reopenAdmission(): void {
    this.deps.resumeRuns();
    this.deps.resumeTasks();
  }

  private reconcileBoot(): void {
    const record = this.deps.state.read();
    const now = this.deps.now();
    if (record === undefined) {
      this.deps.state.write({
        phase: 'current',
        runningCommit: this.deps.runningCommit,
        targetCommit: this.deps.runningCommit,
        lastKnownGood: this.deps.runningCommit,
        updatedAt: now,
      });
      return;
    }
    // A process-local idle waiter cannot survive an unrelated service restart.
    if (record.phase === 'waiting-idle') {
      this.deps.state.write({ ...record, phase: 'cancelled', updatedAt: now });
    }
  }
}

function short(commit: string): string {
  return commit === 'unknown' ? commit : commit.slice(0, 7);
}
