import type { TaskPatch, TaskRepo, TaskRunRecord } from '../../application/ports/task-repo.js';
import type { Task } from '../../domain/tasks/task.js';
import type { Db } from './types.js';

/** SQLite adapter for {@link TaskRepo} (pop-agent.spec §21). */
export class SqliteTaskRepo implements TaskRepo {
  constructor(private readonly db: Db) {}

  list(): Task[] {
    const rows = this.db
      .prepare('SELECT * FROM tasks ORDER BY created_at DESC, id DESC')
      .all() as TaskRow[];
    return rows.map(toTask);
  }

  get(id: string): Task | undefined {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined;
    return row === undefined ? undefined : toTask(row);
  }

  create(task: Task): Task {
    this.db
      .prepare(
        `INSERT INTO tasks
           (id, title, prompt, schedule_kind, interval_minutes, next_run_at,
            enabled, notify_on_finish, archive_chat, created_at,
            last_run_at, last_status, last_chat_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)`,
      )
      .run(
        task.id,
        task.title,
        task.prompt,
        task.scheduleKind,
        task.intervalMinutes ?? null,
        task.nextRunAt ?? null,
        task.enabled ? 1 : 0,
        task.notifyOnFinish ? 1 : 0,
        task.archiveChat ? 1 : 0,
        task.createdAt,
      );
    return task;
  }

  /**
   * Only the fields the caller named. Built as a fragment list rather than a
   * full row write, so an edit of the title can never quietly reset a schedule
   * the caller never mentioned.
   */
  update(id: string, patch: TaskPatch): void {
    const sets: string[] = [];
    const values: (string | number | null)[] = [];

    const put = (column: string, value: string | number | null): void => {
      sets.push(`${column} = ?`);
      values.push(value);
    };

    if (patch.title !== undefined) put('title', patch.title);
    if (patch.prompt !== undefined) put('prompt', patch.prompt);
    if (patch.scheduleKind !== undefined) put('schedule_kind', patch.scheduleKind);
    if ('intervalMinutes' in patch) put('interval_minutes', patch.intervalMinutes ?? null);
    if ('nextRunAt' in patch) put('next_run_at', patch.nextRunAt ?? null);
    if (patch.enabled !== undefined) put('enabled', patch.enabled ? 1 : 0);
    if (patch.notifyOnFinish !== undefined) {
      put('notify_on_finish', patch.notifyOnFinish ? 1 : 0);
    }
    if (patch.archiveChat !== undefined) put('archive_chat', patch.archiveChat ? 1 : 0);
    if (sets.length === 0) return;

    values.push(id);
    this.db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  }

  due(now: number): Task[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM tasks
          WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?
       ORDER BY next_run_at ASC, id ASC`,
      )
      .all(now) as TaskRow[];
    return rows.map(toTask);
  }

  recordRun(id: string, record: TaskRunRecord): void {
    this.db
      .prepare(
        `UPDATE tasks
            SET last_run_at = ?, last_status = ?, last_chat_id = ?,
                next_run_at = ?, enabled = ?
          WHERE id = ?`,
      )
      .run(
        record.lastRunAt,
        record.lastStatus,
        record.lastChatId.length > 0 ? record.lastChatId : null,
        record.nextRunAt ?? null,
        record.enabled ? 1 : 0,
        id,
      );
  }
}

interface TaskRow {
  id: string;
  title: string;
  prompt: string;
  schedule_kind: string;
  interval_minutes: number | null;
  next_run_at: number | null;
  enabled: number;
  notify_on_finish: number;
  archive_chat: number;
  created_at: number;
  last_run_at: number | null;
  last_status: string | null;
  last_chat_id: string | null;
}

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    prompt: row.prompt,
    scheduleKind: row.schedule_kind === 'interval' ? 'interval' : 'once',
    ...(row.interval_minutes === null ? {} : { intervalMinutes: row.interval_minutes }),
    ...(row.next_run_at === null ? {} : { nextRunAt: row.next_run_at }),
    enabled: row.enabled === 1,
    notifyOnFinish: row.notify_on_finish === 1,
    archiveChat: row.archive_chat === 1,
    createdAt: row.created_at,
    ...(row.last_run_at === null ? {} : { lastRunAt: row.last_run_at }),
    ...(row.last_status === null ? {} : { lastStatus: row.last_status }),
    ...(row.last_chat_id === null ? {} : { lastChatId: row.last_chat_id }),
  };
}
