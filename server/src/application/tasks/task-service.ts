import { entityId } from '../../domain/ids.js';
import {
  firstRunAt,
  MAX_INTERVAL_MINUTES,
  type Task,
  type TaskScheduleKind,
} from '../../domain/tasks/task.js';
import type { Clock } from '../ports/clock.js';
import type { TaskRepo } from '../ports/task-repo.js';

/**
 * Everything about a background task that is not running it (pop-agent.spec §21):
 * creating, editing, switching on and off, deleting. The one rule it owns is
 * that a schedule and a `next_run_at` are never allowed to disagree -- any
 * change to the schedule, and any switch back on, recomputes when the task is
 * next due, so an edit takes effect at the next tick instead of at whatever
 * moment the old schedule had already parked.
 */

const MAX_TITLE = 120;
const MAX_PROMPT = 8_000;

/**
 * `| undefined` on every optional: these come straight off a parsed request
 * body, where an absent field is an explicit `undefined`.
 */
export interface TaskInput {
  title: string;
  prompt: string;
  scheduleKind: TaskScheduleKind;
  intervalMinutes?: number | undefined;
  notifyOnFinish?: boolean | undefined;
  archiveChat?: boolean | undefined;
  runOnlyWithNewMessages?: boolean | undefined;
}

export interface TaskEdit {
  title?: string | undefined;
  prompt?: string | undefined;
  scheduleKind?: TaskScheduleKind | undefined;
  intervalMinutes?: number | undefined;
  notifyOnFinish?: boolean | undefined;
  archiveChat?: boolean | undefined;
  runOnlyWithNewMessages?: boolean | undefined;
}

export interface TaskServiceDeps {
  tasks: TaskRepo;
  clock: Clock;
}

export class TaskService {
  constructor(private readonly deps: TaskServiceDeps) {}

  list(): Task[] {
    return this.deps.tasks.list();
  }

  get(id: string): Task | undefined {
    return this.deps.tasks.get(id);
  }

  create(input: TaskInput): Task {
    const now = this.deps.clock.now();
    const schedule = normalize(input.scheduleKind, input.intervalMinutes);
    return this.deps.tasks.create({
      id: entityId('task'),
      title: clip(input.title, MAX_TITLE),
      prompt: clip(input.prompt, MAX_PROMPT),
      scheduleKind: schedule.scheduleKind,
      ...(schedule.intervalMinutes === undefined ? {} : { intervalMinutes: schedule.intervalMinutes }),
      nextRunAt: firstRunAt(schedule, now),
      enabled: true,
      // Notifying is what every task did before the switch existed, so an
      // omitted field keeps that; filing the conversation away is a choice.
      notifyOnFinish: input.notifyOnFinish ?? true,
      archiveChat: input.archiveChat ?? false,
      runOnlyWithNewMessages:
        schedule.scheduleKind === 'interval' && (input.runOnlyWithNewMessages ?? false),
      createdAt: now,
    });
  }

  update(id: string, edit: TaskEdit): Task | undefined {
    const current = this.deps.tasks.get(id);
    if (current === undefined) return undefined;

    const scheduleChanged = edit.scheduleKind !== undefined || edit.intervalMinutes !== undefined;
    const schedule = normalize(
      edit.scheduleKind ?? current.scheduleKind,
      edit.intervalMinutes ?? current.intervalMinutes,
    );

    this.deps.tasks.update(id, {
      ...(edit.title === undefined ? {} : { title: clip(edit.title, MAX_TITLE) }),
      ...(edit.prompt === undefined ? {} : { prompt: clip(edit.prompt, MAX_PROMPT) }),
      ...(edit.notifyOnFinish === undefined ? {} : { notifyOnFinish: edit.notifyOnFinish }),
      ...(edit.archiveChat === undefined ? {} : { archiveChat: edit.archiveChat }),
      runOnlyWithNewMessages:
        schedule.scheduleKind === 'interval'
          ? (edit.runOnlyWithNewMessages ?? current.runOnlyWithNewMessages)
          : false,
      scheduleKind: schedule.scheduleKind,
      intervalMinutes: schedule.intervalMinutes,
      // A schedule the user just changed must be re-parked, or an edit from
      // "every 6 hours" to "every 5 minutes" would still wait six hours.
      ...(scheduleChanged && current.enabled
        ? { nextRunAt: firstRunAt(schedule, this.deps.clock.now()) }
        : {}),
    });
    return this.deps.tasks.get(id);
  }

  /**
   * The enabled switch. Turning a task back on re-parks it from now, so a
   * task that was off for a month does not fire the instant it is enabled
   * (except `once`, which is exactly what "run it once" means).
   */
  toggle(id: string, enabled: boolean): Task | undefined {
    const current = this.deps.tasks.get(id);
    if (current === undefined) return undefined;

    this.deps.tasks.update(id, {
      enabled,
      ...(enabled ? { nextRunAt: firstRunAt(current, this.deps.clock.now()) } : {}),
    });
    return this.deps.tasks.get(id);
  }

  delete(id: string): boolean {
    if (this.deps.tasks.get(id) === undefined) return false;
    this.deps.tasks.delete(id);
    return true;
  }
}

/** An interval without minutes is not an interval; a `once` never has them. */
function normalize(
  scheduleKind: TaskScheduleKind,
  intervalMinutes: number | undefined,
): { scheduleKind: TaskScheduleKind; intervalMinutes?: number } {
  if (scheduleKind !== 'interval') return { scheduleKind: 'once' };
  const minutes = Math.min(Math.max(Math.round(intervalMinutes ?? 1), 1), MAX_INTERVAL_MINUTES);
  return { scheduleKind: 'interval', intervalMinutes: minutes };
}

function clip(text: string, max: number): string {
  return text.trim().slice(0, max);
}
