import { useNavigate } from 'react-router-dom';
import { t } from '../i18n';

/** Placeholder destination for MCP management until the server API exists. */
export function McpPage() {
  const navigate = useNavigate();
  return (
    <div className="min-h-dvh">
      <header className="flex items-center gap-3 border-b border-[var(--border)] p-3">
        <button type="button" onClick={() => navigate('/')} className="rounded-md px-2 py-1 text-[var(--key-fg-dim)] hover:bg-[var(--hover-overlay)]">
          ←
        </button>
        <h1 className="text-lg font-semibold">{t('shell.navMcp')}</h1>
      </header>
      <main className="mx-auto max-w-2xl p-6">
        <p className="text-sm text-[var(--muted)]">MCP configuration will be available here.</p>
      </main>
    </div>
  );
}
