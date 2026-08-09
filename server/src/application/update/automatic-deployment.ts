import type { PushService } from '../ports/push-repo.js';
import type { DeploymentStateStore } from '../ports/deployment.js';
import type { Timer } from '../ports/timer.js';
import type { SettingsService } from '../settings/settings-service.js';
import type { DeploymentCoordinator } from './deployment-coordinator.js';
import type { RunService } from '../chat/run-service.js';
import type { TaskScheduler } from '../tasks/task-scheduler.js';
import { IdleTracker } from './idle-tracker.js';

export const AUTOMATIC_DEPLOYMENT_TICK_MS = 15_000;

/**
 * How long must the server be idle before an automatic restart triggers.
 * @internal
 */
export function automaticIdleMs(settings: SettingsService): number {
  const minutes = settings.read().autoRestartIdleMinutes ?? 10;
  return Math.max(1, minutes) * 60_000;
}

/** Watches local prepared commits; downloading releases remains an operator action. */
export class AutomaticDeploymentService {
  private stopTimer: (() => void) | undefined;
  private ticking = false;
  private idleTracker: IdleTracker | undefined;

  constructor(
    private readonly deps: {
      deployment: DeploymentCoordinator;
      state: DeploymentStateStore;
      settings: SettingsService;
      push: PushService;
      timer: Timer;
      now: () => string;
      onJournal?: (line: string) => void;
    },
  ) {}

  start(): void {
    if (this.stopTimer !== undefined) return;
    this.stopTimer = this.deps.timer.every(AUTOMATIC_DEPLOYMENT_TICK_MS, () => void this.tick());
    void this.tick();
    this.startIdleTracker();
  }

  private startIdleTracker(): void {
    if (this.idleTracker !== undefined) return;
    // Unsafe cast: the coordinator already wraps the actual run/task services.
    const runs = (this.deps.deployment as unknown as { runs: RunService }).runs;
    const tasks = (this.deps.deployment as unknown as { tasks: TaskScheduler }).tasks;
    if (runs === undefined || tasks === undefined) return;
    this.idleTracker = new IdleTracker({
      runs,
      tasks,
      settings: this.deps.settings,
      timer: this.deps.timer,
      now: () => Date.now(),
      onIdle: () => void this.tick(),
    });
    this.idleTracker.start();
  }

  private stopIdleTracker(): void {
    this.idleTracker?.stop();
    this.idleTracker = undefined;
  }

  stop(): void {
    this.stopTimer?.();
    this.stopTimer = undefined;
    this.stopIdleTracker();
  }

  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      this.deps.deployment.reconcileExternalState();
      await this.publishFinishedAutomaticDeployment();
      const enabled = this.deps.settings.read().autoActivatePreparedUpdates;
      if (!enabled) {
        this.deps.deployment.cancelWaiting('automatic');
        return;
      }
      const status = this.deps.deployment.status();
      if (
        status.pending &&
        status.clean &&
        status.prepared &&
        !['waiting-idle', 'restarting', 'rolling-back', 'failed'].includes(status.phase)
      ) {
        const result = this.deps.deployment.requestRestartWhenIdle('automatic');
        if (result.ok) {
          this.deps.onJournal?.(`pop update: automatic activation waiting for idle (${status.headCommit})`);
        }
      }
    } finally {
      this.ticking = false;
    }
  }

  private async publishFinishedAutomaticDeployment(): Promise<void> {
    const record = this.deps.state.read();
    if (
      record?.requestedBy !== 'automatic' ||
      record.notifiedAt !== undefined ||
      !['healthy', 'rolled-back', 'failed'].includes(record.phase)
    ) {
      return;
    }

    const failed = record.phase !== 'healthy';
    if (failed && this.deps.settings.read().autoActivatePreparedUpdates) {
      this.deps.settings.update({ autoActivatePreparedUpdates: false });
    }
    await this.deps.push.send({
      title: 'Pop Agent update',
      body: failed
        ? `Update ${record.targetCommit.slice(0, 7)} failed. Last-known-good was restored and automatic activation was disabled.`
        : `Update ${record.targetCommit.slice(0, 7)} is active and healthy.`,
      url: '/settings?section=updates',
    });
    this.deps.state.write({ ...record, notifiedAt: this.deps.now() });
  }
}
