import type { DeploymentStateStore } from '../ports/deployment.js';
import type { PushService } from '../ports/push-repo.js';
import type { Timer } from '../ports/timer.js';
import type { SettingsService } from '../settings/settings-service.js';
import type { DeploymentCoordinator } from './deployment-coordinator.js';

export const AUTOMATIC_DEPLOYMENT_TICK_MS = 15_000;

/** Watches prepared local commits; downloading releases remains an operator action. */
export class AutomaticDeploymentService {
  private stopTimer: (() => void) | undefined;
  private ticking = false;
  private lastActivityAt: number;

  constructor(
    private readonly deps: {
      deployment: DeploymentCoordinator;
      state: DeploymentStateStore;
      settings: SettingsService;
      push: PushService;
      timer: Timer;
      now: () => string;
      nowMs: () => number;
      onJournal?: (line: string) => void;
    },
  ) {
    this.lastActivityAt = deps.nowMs();
  }

  start(): void {
    if (this.stopTimer !== undefined) return;
    this.stopTimer = this.deps.timer.every(AUTOMATIC_DEPLOYMENT_TICK_MS, () => void this.tick());
    void this.tick();
  }

  stop(): void {
    this.stopTimer?.();
    this.stopTimer = undefined;
  }

  /** Any accepted user message restarts the full quiet period. */
  noteActivity(): void {
    this.lastActivityAt = this.deps.nowMs();
    this.deps.deployment.cancelWaiting('automatic');
  }

  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      this.deps.deployment.reconcileExternalState();
      await this.publishFinishedAutomaticDeployment();
      const settings = this.deps.settings.read();
      if (!settings.autoActivatePreparedUpdates) {
        this.deps.deployment.cancelWaiting('automatic');
        return;
      }
      const quietMs = settings.autoRestartIdleMinutes * 60_000;
      if (this.deps.nowMs() - this.lastActivityAt < quietMs) return;

      const status = this.deps.deployment.status();
      if (
        status.pending &&
        status.clean &&
        status.prepared &&
        !['waiting-idle', 'restarting', 'rolling-back', 'failed'].includes(status.phase)
      ) {
        const result = this.deps.deployment.requestRestartWhenIdle('automatic');
        if (result.ok) {
          this.deps.onJournal?.(
            `pop update: automatic activation waiting for idle (${status.headCommit})`,
          );
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
