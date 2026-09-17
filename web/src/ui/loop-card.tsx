import { useId, useState } from 'react';
import { ChevronDown, ChevronRight, Check } from 'lucide-react';
import type { ToolCallDTO } from '@pop-agent/shared';
import { t } from '../i18n';
import { loopProgress, type LoopStage } from '../lib/loop-progress';
import { Pressable } from './controls';

const phases: LoopStage[] = ['plan', 'worker', 'review'];

/** One foreground workflow call, separate from ordinary tool activity. */
export function LoopCard({ tool, interrupted }: { tool: ToolCallDTO; interrupted: boolean }) {
  const [open, setOpen] = useState(false);
  const detailId = useId();
  const { stages, outcome, corrections, result } = loopProgress(tool, interrupted);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div data-testid="loop-card" className="min-w-0 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)]">
      <Pressable
        type="button"
        aria-expanded={open}
        aria-controls={detailId}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left text-xs text-[var(--muted)] hover:bg-[var(--hover-overlay)]"
      >
        <Chevron aria-hidden="true" className="h-3 w-3 shrink-0" />
        <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{t('chat.loop.title')}</span>
        <span data-testid="loop-outcome" className={`min-w-0 [overflow-wrap:anywhere] ${outcome === 'failed' ? 'text-[var(--danger)]' : outcome === 'approved' ? 'text-[var(--success)]' : ''}`}>
          {t(`chat.loop.outcome.${outcome}`)}
        </span>
      </Pressable>
      <ol className="flex min-w-0 flex-col gap-2 px-3 pb-3 text-xs text-[var(--muted)]">
        {phases.map((phase) => (
          <li key={phase} data-testid={`loop-stage-${phase}`} className="flex min-w-0 items-center gap-2">
            {stages[phase] === 'active' ? (
              <span aria-hidden="true" className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border border-[var(--muted)] border-t-transparent" />
            ) : stages[phase] === 'completed' ? (
              <Check aria-hidden="true" className="h-3 w-3 shrink-0" />
            ) : <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full border border-[var(--border)]" />}
            <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{t(`chat.loop.phase.${phase}`)}</span>
            <span className={stages[phase] === 'error' ? 'text-[var(--danger)]' : ''}>{t(`chat.loop.stage.${stages[phase]}`)}</span>
          </li>
        ))}
      </ol>
      {corrections === undefined ? null : <p className="px-3 pb-3 text-xs text-[var(--muted)]">{t('chat.loop.corrections', { count: corrections })}</p>}
      {open ? (
        <div id={detailId} className="flex min-w-0 flex-col gap-2 px-3 pb-3 text-xs text-[var(--muted)]">
          {result ? <>
            <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{result.summary}</p>
            {result.evidence.length > 0 ? <div>
              <p>{t('chat.loop.evidence')}</p>
              <ul className="list-inside list-disc [overflow-wrap:anywhere]">
                {result.evidence.map((entry, index) => <li key={index}>{entry}</li>)}
              </ul>
            </div> : null}
          </> : null}
          <p>{t('chat.loop.detail')}</p>
          <pre data-testid="loop-output" className="max-w-full overflow-x-auto rounded bg-[var(--input-bg)] p-2 font-mono whitespace-pre-wrap [overflow-wrap:anywhere]">{tool.detail}</pre>
        </div>
      ) : null}
    </div>
  );
}
