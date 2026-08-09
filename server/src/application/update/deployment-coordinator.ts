import type {
  DeploymentInspector,
  DeploymentStateStore,
  DeploymentStatus,
  DeploymentSupervisor,
} from '../ports/deployment.js';

export type DeploymentRequestResult =
  | { ok: true; status: DeploymentStatus }
  | { ok: false; reason: 'already_current' | 'dirty_tree' | 'already_scheduled' };

/**
 * Coordinates the hand-off; it never restarts its own process directly.
 * New runs are paused first, existing chat/task work drains, then a detached
 * supervisor performs restart, health probation and rollback outside this
 * process. That separation is the difference between a safe deployment and an
 * answer that kills itself halfway through its final sentence.
 */
export class DeploymentCoordinator {
  private scheduled = false;

  constructor(
    private readonly deps: {
      runningCommit: string;
      inspector: DeploymentInspector;
      state: DeploymentStateStore;
      supervisor: DeploymentSupervisor;
      /** Refuses new LLM runs, but lets existing work finish. */
      quiesce: () => void;
      resume: () => void;
      waitForIdle: () => Promise<void>;
      now: () => string;
    },
  ) {
    this.recordBoot();
  }

  status(): DeploymentStatus {
    const headCommit = this.deps.inspector.headCommit();
    const pending = headCommit !== this.deps.runningCommit;
    const clean = this.deps.inspector.isClean();
    const record = this.deps.state.read();
    const lastKnownGood = record?.lastKnownGood ?? this.deps.runningCommit;
    const relevant = record !== undefined && record.targetCommit === headCommit;
    const phase = this.scheduled
      ? 'waiting-idle'
      : pending
        ? relevant && record.phase !== 'healthy'
          ? record.phase
          : 'pending'
        : relevant
          ? record.phase
          : 'current';

    return {
      runningCommit: short(this.deps.runningCommit),
      headCommit: short(headCommit),
      lastKnownGood: short(lastKnownGood),
      pending,
      clean,
      phase,
      ...(relevant && record.error !== undefined ? { error: record.error } : {}),
      ...(relevant && record.failedRef !== undefined ? { failedRef: record.failedRef } : {}),
    };
  }

  requestRestartWhenIdle(): DeploymentRequestResult {
    const status = this.status();
    if (!status.pending) return { ok: false, reason: 'already_current' };
    if (!status.clean) return { ok: false, reason: 'dirty_tree' };
    if (
      this.scheduled ||
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
    const now = this.deps.now();
    this.scheduled = true;
    this.deps.quiesce();
    this.deps.state.write({
      phase: 'waiting-idle',
      runningCommit,
      targetCommit,
      lastKnownGood,
      requestedAt: now,
      updatedAt: now,
    });

    void this.deps
      .waitForIdle()
      .then(() => {
        const at = this.deps.now();
        this.deps.state.write({
          phase: 'restarting',
          runningCommit,
          targetCommit,
          lastKnownGood,
          requestedAt: now,
          updatedAt: at,
        });
        this.deps.supervisor.start({ runningCommit, targetCommit, lastKnownGood });
      })
      .catch((error: unknown) => {
        this.scheduled = false;
        this.deps.resume();
        const at = this.deps.now();
        this.deps.state.write({
          phase: 'failed',
          runningCommit,
          targetCommit,
          lastKnownGood,
          requestedAt: now,
          updatedAt: at,
          error: error instanceof Error ? error.message : 'Could not schedule deployment',
        });
      });

    return { ok: true, status: this.status() };
  }

  private recordBoot(): void {
    const record = this.deps.state.read();
    if (record !== undefined) return;
    const now = this.deps.now();
    this.deps.state.write({
      phase: 'current',
      runningCommit: this.deps.runningCommit,
      targetCommit: this.deps.runningCommit,
      lastKnownGood: this.deps.runningCommit,
      updatedAt: now,
    });
  }
}

function short(commit: string): string {
  return commit === 'unknown' ? commit : commit.slice(0, 7);
}
