import type { Task } from '../../domain/tasks/task.js';

/**
 * Persistence for background tasks (pop-agent.spec §21). SQLite is one adapter; the
 * scheduler never learns which.
 */

/** The fields an edit may change; absent means "leave it alone". */
export interface TaskPatch {
  title?: string;
  prompt?: string;
  scheduleKind?: Task['scheduleKind'];
  /** Explicit null clears it (a task that stopped being an interval). */
  intervalMinutes?: number | undefined;
  nextRunAt?: number | undefined;
  enabled?: boolean;
  notifyOnFinish?: boolean;
  archiveChat?: boolean;
  runOnlyWithNewMessages?: boolean;
  activityCursor?: number;
}

/** What a finished run writes back onto the task. */
export interface TaskRunRecord {
  lastRunAt: number;
  lastStatus: string;
  lastChatId: string;
  nextRunAt: number | undefined;
  enabled: boolean;
  activityCursor?: number;
}

export interface TaskRepo {
  /** Newest first, which is the order the list shows. */
  list(): Task[];
  get(id: string): Task | undefined;
  create(task: Task): Task;
  update(id: string, patch: TaskPatch): void;
  delete(id: string): void;

  /** Enabled, scheduled, and not in the future -- soonest first. */
  due(now: number): Task[];

  /** Highest real-user message rowid, excluding prompts injected by task runs. */
  latestUserMessageRowid(atOrBefore?: number): number;
  /** Marks a chat before its prompt is persisted, so it can never count as activity. */
  recordRunChat(taskId: string, chatId: string): void;
  /** Advances a due task without pretending an LLM run happened. */
  recordActivitySkip(id: string, nextRunAt: number | undefined, activityCursor: number): void;

  recordRun(id: string, record: TaskRunRecord): void;
}
