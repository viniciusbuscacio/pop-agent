import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { TaskDTO } from '@pop-agent/shared';
import { t } from '../i18n';
import { useDismiss } from '../lib/dismiss';
import { shortDateTime } from '../lib/time';
import { useTasksStore } from '../store/tasks';
import { Button, Pressable, Menu } from '../ui/controls';

/**
 * The background-task list (docs/specs/Spec-Pop-General.md §21). It lives in the sidebar for the
 * same reason the conversation list does: on a phone the list *is* the screen,
 * and creating or editing one is a route change to a full-screen form -- never
 * a drawer (§14).
 */
export function TasksList({ filter = '' }: { filter?: string }) {
  const tasks = useTasksStore((state) => state.tasks);
  const reload = useTasksStore((state) => state.reload);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (tasks === undefined) return null;

  const query = filter.trim().toLowerCase();
  const shown =
    query.length === 0 ? tasks : tasks.filter((task) => task.title.toLowerCase().includes(query));

  return (
    <div className="flex-1 overflow-y-auto pb-20">
      {shown.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-[var(--muted)]">{t('tasks.none')}</p>
      ) : (
        <ul data-testid="task-list">
          {shown.map((task) => (
            <TaskRow key={task.id} task={task} />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * What the content pane shows while Tasks is the sidebar: on a wide screen the
 * right-hand half would otherwise be blank, and on a phone this never renders
 * because the list is the whole screen.
 */
export function TasksIntro() {
  const navigate = useNavigate();

  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="max-w-sm text-center">
        <h1 className="text-lg font-semibold">{t('tasks.empty.title')}</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">{t('tasks.empty.body')}</p>
        <div className="mt-4 flex justify-center">
          <Button type="button" data-testid="tasks-intro-new" onClick={() => navigate('/tasks/new')}>
            {t('tasks.new')}
          </Button>
        </div>
      </div>
    </div>
  );
}

function TaskRow({ task }: { task: TaskDTO }) {
  const navigate = useNavigate();
  const toggle = useTasksStore((state) => state.toggle);
  const remove = useTasksStore((state) => state.remove);
  const runNow = useTasksStore((state) => state.runNow);
  const reload = useTasksStore((state) => state.reload);

  const [menuOpen, setMenuOpen] = useState(false);
  useDismiss(menuOpen, () => setMenuOpen(false));

  function confirmDelete(): void {
    if (!window.confirm(t('tasks.deleteConfirm', { title: task.title }))) return;
    void remove(task.id);
  }

  return (
    <li
      className="group relative border-b border-[var(--border)] px-4 py-3 last:border-b-0"
      onContextMenu={(event) => {
        event.preventDefault();
        setMenuOpen(true);
      }}
    >
      <div className="flex items-start gap-2 pr-6">
        {/*
          The switch: aria-pressed rather than a checkbox, because it acts the
          moment it is pressed -- there is no form to submit.
        */}
        <Pressable
          type="button"
          data-testid="task-toggle"
          aria-pressed={task.enabled}
          aria-label={task.enabled ? t('tasks.disable') : t('tasks.enable')}
          title={task.enabled ? t('tasks.disable') : t('tasks.enable')}
          onClick={() => void toggle(task.id, !task.enabled)}
          className={`mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors ${
            task.enabled
              ? 'border-transparent bg-[var(--accent)]'
              : 'border-[var(--border)] bg-transparent'
          }`}
        >
          <span
            aria-hidden="true"
            className={
              task.enabled
                ? 'block h-3.5 w-3.5 translate-x-4 rounded-full bg-[var(--accent-fg)] transition-transform'
                : 'block h-3.5 w-3.5 translate-x-0.5 rounded-full bg-[var(--muted)] transition-transform'
            }
          />
        </Pressable>

        <div className="min-w-0 flex-1">
          <Pressable
            type="button"
            data-testid="task-open"
            onClick={() => navigate(`/tasks/${task.id}`)}
            className="block w-full truncate text-left text-sm font-medium"
          >
            {task.title}
          </Pressable>
          <p className="truncate text-xs text-[var(--muted)]">
            {describeSchedule(task)} · {describeNextRun(task)}
          </p>
          <LastRun task={task} />
        </div>
      </div>

      <Pressable
        type="button"
        data-testid="task-menu"
        aria-label={t('tasks.menu')}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => setMenuOpen((value) => !value)}
        className="absolute top-2 right-1 rounded px-2 py-1 text-[var(--muted)] hover:bg-[var(--hover-overlay)] md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100"
      >
        ⋯
      </Pressable>

      {menuOpen ? (
        <Menu
          onPointerDown={(event) => event.stopPropagation()}
          className="absolute top-8 right-2 z-10"
        >
          <MenuItem
            testId="task-run-now"
            label={t('tasks.runNow')}
            onClick={() => {
              setMenuOpen(false);
              // Queued, not instant: the row catches up when the run is over.
              void runNow(task.id).then(() => setTimeout(() => void reload(), 2000));
            }}
          />
          <MenuItem
            testId="task-edit"
            label={t('tasks.edit')}
            onClick={() => {
              setMenuOpen(false);
              navigate(`/tasks/${task.id}`);
            }}
          />
          <MenuItem
            testId="task-delete"
            label={t('tasks.delete')}
            danger
            onClick={() => {
              setMenuOpen(false);
              confirmDelete();
            }}
          />
        </Menu>
      ) : null}
    </li>
  );
}

/** The last outcome, linking to the conversation it happened in. */
function LastRun({ task }: { task: TaskDTO }) {
  if (task.lastRunAt === undefined) return null;

  const failed = task.lastStatus !== undefined && task.lastStatus !== 'ok';
  const label = failed
    ? t('tasks.lastRunFailed', { code: task.lastStatus ?? '', when: shortDateTime(task.lastRunAt) })
    : t('tasks.lastRunOk', { when: shortDateTime(task.lastRunAt) });

  if (task.lastChatId === undefined) {
    return <p className="truncate text-xs text-[var(--muted)]">{label}</p>;
  }

  return (
    <Link
      to={`/chat/${task.lastChatId}`}
      data-testid="task-last-chat"
      title={t('tasks.openChat')}
      className={`block truncate text-xs underline decoration-dotted underline-offset-2 ${
        failed ? 'text-[var(--danger)]' : 'text-[var(--muted)]'
      }`}
    >
      {label}
    </Link>
  );
}

function MenuItem({
  label,
  onClick,
  testId,
  danger = false,
}: {
  label: string;
  onClick: () => void;
  testId: string;
  danger?: boolean;
}) {
  return (
    <Pressable
      type="button"
      role="menuitem"
      data-testid={testId}
      onClick={onClick}
      className={`px-4 py-1.5 text-left whitespace-nowrap hover:bg-[var(--hover-overlay)] ${
        danger ? 'text-[var(--danger)]' : ''
      }`}
    >
      {label}
    </Pressable>
  );
}

/** "Once", "Every 30 minutes", "Every 6 hours", "Every day". */
export function describeSchedule(task: {
  scheduleKind: 'once' | 'interval';
  intervalMinutes?: number;
}): string {
  if (task.scheduleKind !== 'interval') return t('tasks.scheduleOnce');

  const minutes = task.intervalMinutes ?? 1;
  if (minutes === 60) return t('tasks.everyHour');
  if (minutes === 1440) return t('tasks.everyDay');
  if (minutes < 60 || minutes % 60 !== 0) return t('tasks.everyMinutes', { count: minutes });
  return t('tasks.everyHours', { count: minutes / 60 });
}

function describeNextRun(task: TaskDTO): string {
  if (!task.enabled) return t('tasks.off');
  if (task.nextRunAt === undefined) return t('tasks.notScheduled');
  return t('tasks.nextRun', { when: shortDateTime(task.nextRunAt) });
}
