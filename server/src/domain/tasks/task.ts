/**
 * A background task (popy.spec §21): a prompt with a schedule.
 *
 * Two kinds and no more, because a cron expression is a language and this is a
 * personal agent: `once` runs at the next tick and switches itself off,
 * `interval` runs every N minutes forever. Everything here is epoch
 * milliseconds, so the schedule is arithmetic on what the clock port returns.
 */

export type TaskScheduleKind = 'once' | 'interval';

export interface Task {
  id: string;
  /** Also the title of every conversation the task opens. */
  title: string;
  prompt: string;
  scheduleKind: TaskScheduleKind;
  /** Present only for `interval`. */
  intervalMinutes?: number;
  /** When the scheduler should pick it up; absent means nothing is scheduled. */
  nextRunAt?: number;
  enabled: boolean;
  createdAt: number;
  lastRunAt?: number;
  /** `ok`, or the failure code the run ended with. */
  lastStatus?: string;
  lastChatId?: string;
}

export const MINUTE_MS = 60_000;

/** Longest interval the schema accepts: a year, in minutes. */
export const MAX_INTERVAL_MINUTES = 365 * 24 * 60;

/**
 * When the task should run after a run that just finished at `now`. An
 * interval task is pushed a whole interval forward from the moment it
 * *finished*, not from when it was due -- a task that takes longer than its
 * own interval must not queue up behind itself.
 */
export function nextRunAfter(task: Task, now: number): number | undefined {
  if (task.scheduleKind !== 'interval') return undefined;
  return now + Math.max(1, task.intervalMinutes ?? 1) * MINUTE_MS;
}

/** A `once` task is spent by running; an `interval` task keeps its switch. */
export function enabledAfterRun(task: Task): boolean {
  return task.scheduleKind === 'interval' && task.enabled;
}

/**
 * The first run after the task is created or switched back on. `once` means
 * "run it now", which in practice is the next tick.
 */
export function firstRunAt(
  schedule: { scheduleKind: TaskScheduleKind; intervalMinutes?: number },
  now: number,
): number {
  return schedule.scheduleKind === 'interval'
    ? now + Math.max(1, schedule.intervalMinutes ?? 1) * MINUTE_MS
    : now;
}

export function isDue(task: Task, now: number): boolean {
  return task.enabled && task.nextRunAt !== undefined && task.nextRunAt <= now;
}
