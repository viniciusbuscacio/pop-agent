import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { t } from '../i18n';
import { tasksService } from '../services/tasks';
import { useTasksStore } from '../store/tasks';
import { Button, Card, CheckField, Segmented, Select, TextArea, TextField, Pressable } from '../ui/controls';

/**
 * Creating and editing a background task (pop-agent.spec §21) as a **full screen**
 * with a back button -- never a drawer or a modal (permanent house veto,
 * pop-agent.spec §14). One component serves both: with a `:taskId` it loads the
 * task first, without one it starts blank.
 */

type Unit = 'minutes' | 'hours';

export function TaskFormPage() {
  const navigate = useNavigate();
  const { taskId } = useParams();
  const reload = useTasksStore((state) => state.reload);

  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [scheduleKind, setScheduleKind] = useState<'once' | 'interval'>('once');
  const [every, setEvery] = useState('30');
  const [unit, setUnit] = useState<Unit>('minutes');
  const [notifyOnFinish, setNotifyOnFinish] = useState(true);
  const [archiveChat, setArchiveChat] = useState(false);
  const [runOnlyWithNewMessages, setRunOnlyWithNewMessages] = useState(false);
  const [loading, setLoading] = useState(taskId !== undefined);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (taskId === undefined) return;
    let cancelled = false;
    tasksService
      .get(taskId)
      .then((task) => {
        if (cancelled) return;
        setTitle(task.title);
        setPrompt(task.prompt);
        setScheduleKind(task.scheduleKind);
        setNotifyOnFinish(task.notifyOnFinish);
        setArchiveChat(task.archiveChat);
        setRunOnlyWithNewMessages(task.runOnlyWithNewMessages);
        const minutes = task.intervalMinutes ?? 30;
        // Whole hours read as hours; anything else stays in minutes, so a
        // 90-minute schedule is not silently rounded on its way to the form.
        if (minutes >= 60 && minutes % 60 === 0) {
          setUnit('hours');
          setEvery(String(minutes / 60));
        } else {
          setUnit('minutes');
          setEvery(String(minutes));
        }
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) navigate('/tasks', { replace: true });
      });
    return () => {
      cancelled = true;
    };
  }, [taskId, navigate]);

  const minutes = Math.max(1, Math.round(Number(every) || 0)) * (unit === 'hours' ? 60 : 1);
  const canSave =
    title.trim().length > 0 &&
    prompt.trim().length > 0 &&
    (scheduleKind === 'once' || Number(every) >= 1) &&
    !saving;

  async function save(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!canSave) return;

    setSaving(true);
    setError(undefined);
    try {
      const body = {
        title: title.trim(),
        prompt: prompt.trim(),
        scheduleKind,
        ...(scheduleKind === 'interval' ? { intervalMinutes: minutes } : {}),
        notifyOnFinish,
        archiveChat,
        runOnlyWithNewMessages,
      };
      if (taskId === undefined) await tasksService.create(body);
      else await tasksService.update(taskId, body);
      await reload();
      navigate('/tasks');
    } catch {
      setError(t('tasks.form.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
      <header className="flex items-center gap-3 border-b border-[var(--border)] p-3">
        <Pressable
          type="button"
          data-testid="task-form-back"
          aria-label={t('common.back')}
          onClick={() => navigate('/tasks')}
          className="rounded-md px-2 py-1 text-[var(--key-fg-dim)] hover:bg-[var(--hover-overlay)]"
        >
          ←
        </Pressable>
        <h1 className="text-lg font-semibold">
          {taskId === undefined ? t('tasks.form.newTitle') : t('tasks.form.editTitle')}
        </h1>
      </header>

      {loading ? (
        <p className="p-6 text-sm text-[var(--muted)]">{t('app.loading')}</p>
      ) : (
        <form onSubmit={(event) => void save(event)} className="mx-auto max-w-2xl p-4">
          <Card className="flex flex-col gap-5">
            <TextField
              id="task-title"
              data-testid="task-title"
              label={t('tasks.form.title')}
              hint={t('tasks.form.titleHint')}
              value={title}
              maxLength={120}
              onChange={(event) => setTitle(event.target.value)}
            />

            <TextArea
              id="task-prompt"
              data-testid="task-prompt"
              label={t('tasks.form.prompt')}
              hint={t('tasks.form.promptHint')}
              rows={8}
              maxLength={8000}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
            />

            <div className="flex flex-col gap-2">
              <span className="text-sm text-[var(--key-fg-dim)]">{t('tasks.form.schedule')}</span>
              <Segmented<'once' | 'interval'>
                ariaLabel={t('tasks.form.schedule')}
                value={scheduleKind}
                onChange={setScheduleKind}
                options={[
                  { value: 'once', label: t('tasks.form.once'), testId: 'task-schedule-once' },
                  {
                    value: 'interval',
                    label: t('tasks.form.interval'),
                    testId: 'task-schedule-interval',
                  },
                ]}
              />
              {scheduleKind === 'interval' ? (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <TextField
                      id="task-interval"
                      type="number"
                      min={1}
                      data-testid="task-interval"
                      aria-label={t('tasks.form.interval')}
                      value={every}
                      onChange={(event) => setEvery(event.target.value)}
                      className="w-24"
                    />
                    <Select
                      id="task-interval-unit"
                      data-testid="task-interval-unit"
                      aria-label={t('tasks.form.unit')}
                      value={unit}
                      onChange={(event) =>
                        setUnit(event.target.value === 'hours' ? 'hours' : 'minutes')
                      }
                    >
                      <option value="minutes">{t('tasks.form.unitMinutes')}</option>
                      <option value="hours">{t('tasks.form.unitHours')}</option>
                    </Select>
                  </div>
                  <CheckField
                    id="task-new-messages"
                    testId="task-new-messages"
                    label={t('tasks.form.newMessages')}
                    hint={t('tasks.form.newMessagesHint')}
                    checked={runOnlyWithNewMessages}
                    onChange={setRunOnlyWithNewMessages}
                  />
                </div>
              ) : (
                <p className="text-xs text-[var(--muted)]">{t('tasks.form.onceHint')}</p>
              )}
            </div>

            <div className="flex flex-col gap-3 border-t border-[var(--border)] pt-4">
              <span className="text-sm text-[var(--key-fg-dim)]">
                {t('tasks.form.whenDone')}
              </span>
              <CheckField
                id="task-notify"
                testId="task-notify"
                label={t('tasks.form.notify')}
                hint={t('tasks.form.notifyHint')}
                checked={notifyOnFinish}
                onChange={setNotifyOnFinish}
              />
              <CheckField
                id="task-archive"
                testId="task-archive"
                label={t('tasks.form.archive')}
                hint={t('tasks.form.archiveHint')}
                checked={archiveChat}
                onChange={setArchiveChat}
              />
            </div>

            {error !== undefined ? (
              <p role="alert" className="text-xs text-[var(--danger)]">
                {error}
              </p>
            ) : null}

            {/* Every Save has a Cancel (pop-agent.spec §14). */}
            <div className="flex gap-2">
              <Button type="submit" data-testid="task-save" disabled={!canSave}>
                {t('common.save')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                data-testid="task-cancel"
                onClick={() => navigate('/tasks')}
              >
                {t('common.cancel')}
              </Button>
            </div>
          </Card>
        </form>
      )}
    </div>
  );
}
