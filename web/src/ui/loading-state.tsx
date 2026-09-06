import { t } from '../i18n';
import { PopBubbleMark } from './pop-bubble-mark';
import { WorkingIndicator } from './run-status-line';

/** Branded loading shared by application boot and the setup state request. */
export function LoadingState({ label = t('app.loading') }: { label?: string } = {}) {
  return (
    <div role="status" className="flex flex-col items-center justify-center gap-5 py-8">
      <PopBubbleMark className="h-24 w-24 select-none text-[var(--muted)] opacity-25" />
      <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
        <WorkingIndicator />
        <span>{label}</span>
      </div>
    </div>
  );
}
