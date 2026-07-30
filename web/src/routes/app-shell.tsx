import { useNavigate } from 'react-router-dom';
import { t } from '../i18n';
import { Button } from '../ui/controls';

/**
 * The main screen. Layout follows the Telegram model rather than a slide-over
 * drawer: on a wide screen the list sits beside the content; on a narrow one
 * the list *is* the screen and opening something is a route change, so the
 * phone's back gesture behaves the way the user expects.
 *
 * There is nothing to list yet -- conversations arrive with the chat -- so the
 * structure is here and honest about being empty.
 */
export function AppShell() {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-dvh">
      <aside className="flex w-full flex-col border-[var(--border)] md:w-72 md:border-r">
        <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] p-3">
          <span className="font-semibold">{t('app.name')}</span>
          <button
            type="button"
            data-testid="shell-settings"
            aria-label={t('shell.settings')}
            onClick={() => navigate('/settings')}
            className="rounded-md p-2 text-[var(--key-fg-dim)] hover:bg-[var(--hover-overlay)]"
          >
            <GearIcon />
          </button>
        </div>

        <div className="p-3">
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            data-testid="shell-new-chat"
            disabled
            title={t('common.comingSoon')}
          >
            {t('shell.newChat')}
          </Button>
          <p className="mt-2 text-center text-xs text-[var(--muted)]">{t('common.comingSoon')}</p>
        </div>
      </aside>

      {/* On a narrow screen the sidebar above is the whole screen. */}
      <main className="hidden flex-1 items-center justify-center p-8 md:flex">
        <div className="max-w-sm text-center">
          <h1 className="text-lg font-semibold">{t('shell.empty.title')}</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">{t('shell.empty.body')}</p>
        </div>
      </main>
    </div>
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
