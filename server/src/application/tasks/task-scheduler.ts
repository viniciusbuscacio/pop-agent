import { enabledAfterRun, nextRunAfter } from '../../domain/tasks/task.js';
import type { Clock } from '../ports/clock.js';
import type { MaintenanceJob } from '../ports/maintenance-job.js';
import type { TaskRepo } from '../ports/task-repo.js';
import type { Timer } from '../ports/timer.js';
import type { ChatService } from '../chat/chat-service.js';
import type { RunService } from '../chat/run-service.js';

/**
 * The one clock in the process that makes things happen on their own
 * (pop-agent.spec §21).
 *
 * Every tick it asks the repository what is due, appends those tasks to a
 * queue, and works the queue **one at a time**. Serialised on purpose: a task
 * run is a full agent turn with a workspace and a process group behind it, and
 * two of them racing on a small VPS is how a personal server falls over. The
 * global run ceiling would not save us either -- it counts chats, and every
 * task run is its own new chat.
 *
 * A task run that fails is a recorded outcome, never an exception: the catch
 * is total, the status is written down, and the loop moves to the next task.
 * A scheduler that could be killed by one bad prompt would be worse than no
 * scheduler at all.
 *
 * Maintenance jobs (§21, the orphan sweep) ride the same tick instead of
 * owning timers of their own.
 */

/** Half a minute: fine enough for a schedule measured in minutes. */
export const TASK_TICK_MS = 30_000;

export interface TaskSchedulerDeps {
  tasks: TaskRepo;
  /** Opens the conversation each run writes into. */
  chats: ChatService;
  /** The normal pipeline: failover, compaction and error persistence for free. */
  runs: RunService;
  clock: Clock;
  timer: Timer;
  /** Overridable so a test does not wait thirty real seconds. */
  tickMs?: number;
  /** Internal housekeeping, invisible to the user (pop-agent.spec §21). */
  jobs?: MaintenanceJob[];
  /** One line per finished run; main.ts sends it to the journal. */
  onJournal?: (line: string) => void;
}

export type TaskRunNowResult = 'started' | 'not_found' | 'paused';

export class TaskScheduler {
  private readonly queue: string[] = [];
  private running: string | undefined;
  private pumping = false;
  private readonly idleWaiters: (() => void)[] = [];
  private stopTimer: (() => void) | undefined;
  private admissionPaused = false;
  /** When each maintenance job last ran, so the cadence survives a busy tick. */
  private readonly jobRuns = new Map<string, number>();

  constructor(private readonly deps: TaskSchedulerDeps) {}

  /** Wires the tick. Idempotent, so a double start cannot double the rate. */
  start(): void {
    if (this.stopTimer !== undefined || this.admissionPaused) return;
    this.stopTimer = this.deps.timer.every(this.deps.tickMs ?? TASK_TICK_MS, () => {
      void this.tick();
    });
  }

  stop(): void {
    this.stopTimer?.();
    this.stopTimer = undefined;
  }

  /**
   * One pass: enqueue everything due, work the queue to the end, then let the
   * maintenance jobs have their turn. Awaited by the tests; the timer calls it
   * and forgets, because a tick that overlaps the previous one still finds the
   * pump busy and returns immediately.
   */
  async tick(): Promise<void> {
    if (this.admissionPaused) return;
    const now = this.deps.clock.now();
    for (const task of this.deps.tasks.due(now)) this.enqueue(task.id);
    await this.pump();
    await this.runJobs(now);
  }

  /**
   * "Run now" from the UI. False when there is no such task. The run happens
   * in the same single-file queue as a scheduled one, so pressing the button
   * during a run waits rather than doubling up.
   */
  runNow(taskId: string): TaskRunNowResult {
    if (this.deps.tasks.get(taskId) === undefined) return 'not_found';
    if (this.admissionPaused) return 'paused';
    this.enqueue(taskId);
    void this.pump();
    return 'started';
  }

  /** Stops new scheduled/manual admissions while already accepted work drains. */
  pauseAdmission(): void {
    this.admissionPaused = true;
    this.stop();
  }

  resumeAdmission(): void {
    if (!this.admissionPaused) return;
    this.admissionPaused = false;
    this.start();
  }

  /** Resolves once the queue is empty and nothing is running. */
  whenIdle(): Promise<void> {
    if (!this.pumping && this.queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private enqueue(taskId: string): void {
    // A task that is already waiting, or already running, is not queued twice:
    // a tick during a long run must not stack up copies of it.
    if (this.running === taskId || this.queue.includes(taskId)) return;
    this.queue.push(taskId);
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      for (;;) {
        const taskId = this.queue.shift();
        if (taskId === undefined) return;
        this.running = taskId;
        try {
          await this.runTask(taskId);
        } finally {
          this.running = undefined;
        }
      }
    } finally {
      this.pumping = false;
      for (const resolve of this.idleWaiters.splice(0)) resolve();
    }
  }

  /**
   * One task run, from opening the chat to writing down what happened.
   *
   * The chat is renamed to the task's title through {@link ChatService.rename},
   * which is the *manual* rename path: it switches auto-titling off for that
   * conversation, so neither the deterministic first-message fallback nor the
   * service model will ever rewrite a name the user chose for the task.
   */
  private async runTask(taskId: string): Promise<void> {
    const task = this.deps.tasks.get(taskId);
    if (task === undefined) return; // deleted between being queued and now

    let chatId = '';
    let status = 'ok';

    try {
      const chat = this.deps.chats.create();
      chatId = chat.id;
      this.deps.chats.rename(chat.id, task.title);

      const started = this.deps.runs.startRun(chat.id, task.prompt, [], {
        notify: task.notifyOnFinish,
      });
      if (started.ok) {
        const outcome = await this.deps.runs.whenRunEnds(started.runId);
        status = outcome.ok ? 'ok' : outcome.code;
      } else {
        status = started.reason;
      }
    } catch {
      // Nothing a single task does may take the scheduler with it: the failure
      // becomes this run's status and the queue moves on.
      status = 'operation_error';
    }

    // Filed as soon as it is written, when the task asked for that: a task on
    // a short interval otherwise buries the sidebar under its own output. The
    // conversation is still there and the task's last status still links to
    // it. Archiving is never allowed to change the run's recorded outcome, so
    // a failure here is swallowed exactly like the run's own.
    if (task.archiveChat && chatId.length > 0) {
      try {
        this.deps.chats.setArchived(chatId, true);
      } catch {
        // The run happened; where its chat sits is not worth a lost status.
      }
    }

    const finishedAt = this.deps.clock.now();
    this.deps.tasks.recordRun(taskId, {
      lastRunAt: finishedAt,
      lastStatus: status,
      lastChatId: chatId,
      nextRunAt: nextRunAfter(task, finishedAt),
      enabled: enabledAfterRun(task),
    });
    this.deps.onJournal?.(
      `pop task: id=${taskId} title=${task.title} status=${status} chat=${chatId}`,
    );
  }

  /** Maintenance on its own cadence, and just as unkillable. */
  private async runJobs(now: number): Promise<void> {
    for (const job of this.deps.jobs ?? []) {
      const last = this.jobRuns.get(job.name);
      // Unrun jobs go on the first tick: a server that reboots daily would
      // otherwise never reach a daily job's due time.
      if (last !== undefined && now - last < job.everyMs) continue;
      this.jobRuns.set(job.name, now);
      try {
        await job.run();
      } catch (error) {
        this.deps.onJournal?.(
          `pop job ${job.name} failed: ${error instanceof Error ? error.message : 'unknown'}`,
        );
      }
    }
  }
}
