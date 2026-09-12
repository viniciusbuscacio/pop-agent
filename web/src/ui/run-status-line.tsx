import { useEffect, useState } from 'react';
import { t } from '../i18n';

const WORKING_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;
const WORKING_FRAME_MS = 140;

/**
 * One run-level status between the transcript and the composer.
 *
 * Tools and assistant messages describe what happened; this line answers the
 * separate question of whether the run is still alive. The animation is local
 * presentation -- the server sends run lifecycle, never spinner frames.
 */
export function RunStatusLine({ status }: { status: 'queued' | 'running' | 'approval' }) {

  return (
    <div
      data-testid="run-status-line"
      role="status"
      className="mx-auto flex w-full shrink-0 items-center gap-2 px-4 py-1 text-sm text-[var(--muted)] md:w-[95%]"
    >
      {status === 'running' ? (
        <>
          <WorkingIndicator />
          <span>{t('chat.working')}</span>
        </>
      ) : (
        <span>{status === 'approval' ? t('chat.waitingApproval') : t('chat.waitingTurn')}</span>
      )}
    </div>
  );
}

/** The shared activity animation for runs and initial loading. */
export function WorkingIndicator() {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setFrame((current) => (current + 1) % WORKING_FRAMES.length);
    }, WORKING_FRAME_MS);
    return () => window.clearInterval(timer);
  }, []);

  return <span data-testid="working-indicator" aria-hidden="true" className="font-mono">{WORKING_FRAMES[frame]}</span>;
}
