import { t } from '../i18n';
import { SidebarNav } from './sidebar-nav';

/**
 * MCP as the right-hand pane of the shell (popy.spec §14), reached from the
 * Agent row. The server API does not exist yet, so this is a placeholder --
 * the sidebar carries the (empty) list and the search, matching Skills and the
 * rest of the explorer; here is only where the detail will live.
 */
export function McpPage() {
  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
      {/* On a phone this pane IS the screen, so it carries the navigation
          itself — exactly what Files does. Without it there is no way back. */}
      <div className="border-b border-[var(--border)] md:hidden">
        <SidebarNav />
      </div>
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="max-w-sm text-center text-sm text-[var(--muted)]">{t('mcp.placeholder')}</p>
      </div>
    </div>
  );
}
