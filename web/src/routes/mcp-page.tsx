import { t } from '../i18n';
import { SidebarNav } from './sidebar-nav';

/**
 * Placeholder destination for MCP management until the server API exists.
 *
 * A pane of the shell, not a screen of its own: it is reached from the Agent
 * row in the sidebar, which has to still be there when you arrive. Hence no
 * back arrow either -- the sidebar is the way back.
 */
export function McpPage() {
  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
      {/* On a phone this pane IS the screen, so it carries the navigation
          itself — exactly what Files does. Without it there is no way back. */}
      <div className="border-b border-[var(--border)] md:hidden">
        <SidebarNav />
      </div>
      <header className="flex items-center gap-3 border-b border-[var(--border)] p-3">
        <h1 className="text-lg font-semibold">{t('shell.navMcp')}</h1>
      </header>
      <main className="mx-auto w-full max-w-2xl p-6">
        <p className="text-sm text-[var(--muted)]">{t('mcp.placeholder')}</p>
      </main>
    </div>
  );
}
