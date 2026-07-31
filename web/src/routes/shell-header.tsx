import { useNavigate } from 'react-router-dom';
import { t } from '../i18n';

/**
 * The app header: the wordmark and the Settings gear. The sidebar always
 * shows it; on a phone, a screen that replaces the sidebar (Files) renders
 * its own copy, so the top of the app looks the same on every width.
 */
export function ShellHeader({
  className = '',
  settingsTestId = 'shell-settings',
}: {
  className?: string;
  settingsTestId?: string;
}) {
  const navigate = useNavigate();
  return (
    <header
      className={`flex items-center justify-between gap-2 border-b border-[var(--border)] p-3 ${className}`}
    >
      <span className="font-semibold">{t('app.name')}</span>
      <button
        type="button"
        data-testid={settingsTestId}
        aria-label={t('shell.settings')}
        onClick={() => navigate('/settings')}
        className="rounded-md p-2 text-[var(--key-fg-dim)] hover:bg-[var(--hover-overlay)]"
      >
        <GearIcon />
      </button>
    </header>
  );
}

function GearIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6c.6-.25 1-.83 1-1.51V3a2 2 0 1 1 4 0v.09c0 .68.4 1.26 1 1.51.6.25 1.3.13 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.25.6.83 1 1.51 1H21a2 2 0 1 1 0 4h-.09c-.68 0-1.26.4-1.51 1Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}
