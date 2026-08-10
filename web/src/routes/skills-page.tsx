import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { SkillDistillationAttemptDTO, SkillDistillationResultDTO } from '@pop-agent/shared';
import { t } from '../i18n';
import { SkillEditor } from './skill-editor';
import { SidebarNav } from './sidebar-nav';
import { useSkillsStore } from '../store/skills';
import { skillsService } from '../services/skills';
import { Button, Card } from '../ui/controls';
import { relativeTime } from '../lib/time';

/**
 * Skills as the right-hand pane of the shell (pop-agent.spec §8, §14), the explorer
 * layout Chat and Files use: the sidebar carries the list, and this pane shows
 * the skill you picked. No `:slug` is the empty pane on a wide screen; `new`
 * starts a blank editor; any other slug edits that skill. On a phone the list
 * is the screen, so this pane only mounts once a skill is open.
 */
export function SkillsPage() {
  const navigate = useNavigate();
  const { slug } = useParams();
  const skills = useSkillsStore((state) => state.skills);
  const reload = useSkillsStore((state) => state.reload);

  useEffect(() => {
    void reload();
  }, [reload]);

  const isNew = slug === 'new';
  const isActivity = slug === '_activity';
  const skill = isNew || isActivity ? undefined : skills?.find((entry) => entry.slug === slug);

  // A dead link (a deleted skill) falls back to the list once skills arrived.
  useEffect(() => {
    if (!isNew && !isActivity && slug !== undefined && skills !== undefined && skill === undefined) {
      navigate('/skills', { replace: true });
    }
  }, [isNew, isActivity, slug, skills, skill, navigate]);

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
      {/* The phone's copy of the nav, with no rule under it -- the sidebar's
          copy has none, so the line only ever showed on the pane screens. */}
      <div className="md:hidden">
        <SidebarNav />
      </div>
      {slug === undefined || isActivity ? (
        <DistillationActivity />
      ) : isNew || skill !== undefined ? (
        <div className="mx-auto w-full max-w-3xl p-4">
          <SkillEditor
            skill={skill}
            onDone={() => {
              void reload();
              navigate('/skills');
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

/** Durable reasons behind the auto-skill inbox, grouped by conversation window. */
function DistillationActivity() {
  const [attempts, setAttempts] = useState<SkillDistillationAttemptDTO[] | undefined>(undefined);
  const [retrying, setRetrying] = useState<string | undefined>(undefined);

  async function reload(): Promise<void> {
    try {
      setAttempts((await skillsService.distillations()).attempts);
    } catch {
      setAttempts((current) => current ?? []);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function retry(id: string): Promise<void> {
    setRetrying(id);
    try {
      await skillsService.retryDistillation(id);
      await reload();
    } finally {
      setRetrying(undefined);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 p-4" data-testid="distillation-activity">
      <div>
        <h1 className="text-lg font-semibold">{t('skills.activity.title')}</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">{t('skills.activity.body')}</p>
      </div>
      {attempts === undefined ? null : attempts.length === 0 ? (
        <Card><p className="text-sm text-[var(--muted)]">{t('skills.activity.empty')}</p></Card>
      ) : (
        attempts.map((attempt) => (
          <Card key={attempt.id} className="flex flex-col gap-2" data-testid="distillation-attempt">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <Link className="font-medium hover:underline" to={`/chat/${attempt.chatId}`}>
                  {attempt.chatTitle}
                </Link>
                <p className="text-xs text-[var(--muted)]">{relativeTime(attempt.startedAt)}</p>
              </div>
              <span className="rounded border border-[var(--border)] px-2 py-0.5 text-xs">
                {attemptLabel(attempt)}
              </span>
            </div>
            <p className="text-sm text-[var(--muted)]">{attemptExplanation(attempt)}</p>
            {attempt.results.length === 0 ? null : (
              <div className="flex flex-col gap-1">
                {attempt.results.map((result, index) => (
                  <p key={`${result.slug}-${String(index)}`} className="text-xs">
                    <span className="font-medium">{result.slug}</span>
                    <span className="text-[var(--muted)]"> — {resultExplanation(result)}</span>
                  </p>
                ))}
              </div>
            )}
            {attempt.warnings.length === 0 ? null : (
              <p className="text-xs text-[var(--muted)]">{attempt.warnings.join(' · ')}</p>
            )}
            {attempt.retryable ? (
              <div>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={retrying === attempt.id}
                  onClick={() => void retry(attempt.id)}
                >
                  {retrying === attempt.id ? t('skills.activity.queueing') : t('skills.activity.retry')}
                </Button>
              </div>
            ) : null}
          </Card>
        ))
      )}
    </div>
  );
}

function attemptLabel(attempt: SkillDistillationAttemptDTO): string {
  if (attempt.state === 'queued') return t('skills.activity.queued');
  if (attempt.state === 'running') return t('skills.activity.running');
  switch (attempt.outcome) {
    case 'produced': return t('skills.activity.produced');
    case 'nothing': return t('skills.activity.nothing');
    case 'tainted': return t('skills.activity.tainted');
    case 'invalid_output': return t('skills.activity.invalid');
    default: return t('skills.activity.failed');
  }
}

function attemptExplanation(attempt: SkillDistillationAttemptDTO): string {
  if (attempt.state === 'queued') return t('skills.activity.queuedNote');
  if (attempt.state === 'running') return t('skills.activity.runningNote');
  if (attempt.errorMessage !== undefined) return attempt.errorMessage;
  if (attempt.outcome === 'nothing') return t('skills.activity.nothingNote');
  if (attempt.outcome === 'tainted') {
    return t('skills.activity.taintedNote', { level: attempt.riskLevel ?? 'suspicious' });
  }
  return t('skills.activity.producedNote', { count: attempt.results.length });
}

function resultExplanation(result: SkillDistillationResultDTO): string {
  if (result.disposition === 'revision') {
    const score = result.similarity === undefined ? '' : ` · cos ${result.similarity.toFixed(2)}`;
    const overlap = result.overlap === undefined ? '' : ` · voc ${result.overlap.toFixed(2)}`;
    const reason = result.reason === 'slug_collision'
      ? t('skills.activity.slugCollision')
      : t('skills.activity.dedupMatch');
    return `${t('skills.activity.result.revision', { target: result.targetSlug ?? result.slug })} · ${reason}${score}${overlap}`;
  }
  switch (result.disposition) {
    case 'pending': return t('skills.activity.result.pending');
    case 'live': return t('skills.activity.result.live');
    case 'updated': return t('skills.activity.result.updated');
    case 'rejected': return t('skills.activity.result.rejected');
    case 'skipped_user': return t('skills.activity.result.skipped_user');
    case 'skipped_builtin': return t('skills.activity.result.skipped_builtin');
    case 'gone': return t('skills.activity.result.gone');
  }
}
