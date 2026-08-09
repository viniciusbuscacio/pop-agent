import type { SettingsService } from '../settings/settings-service.js';
import type { Timer } from '../ports/timer.js';
import type { RunService } from '../chat/run-service.js';
import type { TaskScheduler } from '../tasks/task-scheduler.js';

export interface IdleTrackerDeps {
  runs: RunService;
  tasks: TaskScheduler;
  settings: SettingsService;
  timer: Timer;
  now: () => number;
  onIdle: () => void;
}

/**
 * Tracks the last time any work (runs or tasks) happened and notifies when
 * the server has been idle for the configured duration.
 */
export class IdleTracker {
  private lastActive: number;
  private stop: (() => void) | undefined;
  private timeoutId: any;

  constructor(private readonly deps: IdleTrackerDeps) {
    this.lastActive = deps.now();
    // Start listening immediately (no need to wait for an "enabled" flag).
    this.attach();
  }

  private attach(): void {
    this.deps.runs.onLlmStarted = this.reset;
    this.deps.tasks.onEnqueued = this.reset;
    // Runs and tasks tick independently — capture both.
  }

  private reset = () => {
    this.lastActive = this.deps.now();
    this.scheduleCheck();
  };

  private scheduleCheck(): void {
    if (this.timeoutId) {
      this.deps.timer.clearTimeout(this.timeoutId);
    }
    const idleMs = automaticIdleMs(this.deps.settings);
    this.timeoutId = this.deps.timer.setTimeout(() => {
      this.checkIdle();
    }, idleMs);
  }

  private checkIdle(): void {
    // If still active recently, reschedule.
    const now = this.deps.now();
    const idleMs = automaticIdleMs(this.deps.settings);
    if (now - this.lastActive < idleMs) {
      this.scheduleCheck();
      return;
    }

    // Truly idle — notify once.
    this.deps.onIdle();

    // After firing, stop listening until re-enabled (avoid duplicate timers).
    this.stop?.();
  }

  start(): void {
    this.stop = this.deps.timer.every(1_000, () => {
      // Always keep the timer ticking so we can detect idle even if nothing runs.
      this.checkIdle();
    });
    this.attach();
  }

  stop(): void {
    this.stop?.();
    this.stop = undefined;
    if (this.timeoutId) {
      this.deps.timer.clearTimeout(this.timeoutId);
      this.timeoutId = undefined;
    }
  }
}
