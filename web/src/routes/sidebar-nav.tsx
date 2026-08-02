import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { t } from '../i18n';

/** Primary navigation shared by the desktop sidebar and the mobile Files view. */
export function SidebarNav() {
  const location = useLocation();
  const agentChild = location.pathname === '/tasks' || location.pathname === '/mcp' || location.search.includes('section=skills');
  const [agentOpen, setAgentOpen] = useState(() => {
    try {
      return localStorage.getItem('popy.agentExpanded') !== 'false' || agentChild;
    } catch {
      return true;
    }
  });

  function toggleAgent(): void {
    setAgentOpen((open) => {
      const next = !open;
      try {
        localStorage.setItem('popy.agentExpanded', String(next));
      } catch {
        // Navigation still works when storage is unavailable.
      }
      return next;
    });
  }

  return (
    <nav aria-label={t('shell.navigation')} className="flex flex-col gap-1 px-3 pt-3">
      <PrimaryLink to="/" label={t('shell.navChat')} active={location.pathname.startsWith('/chat') || location.pathname === '/'} />
      <PrimaryLink to="/files" label={t('shell.navFiles')} active={location.pathname.startsWith('/files')} />
      <button
        type="button"
        aria-expanded={agentOpen}
        data-testid="sidebar-agent"
        onClick={toggleAgent}
        className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm font-medium text-[var(--key-fg-dim)] hover:bg-[var(--hover-overlay)]"
      >
        <span>{t('shell.navAgent')}</span>
        <span aria-hidden="true" className="text-xs">{agentOpen ? '⌄' : '›'}</span>
      </button>
      {agentOpen ? (
        <div className="ml-3 flex flex-col gap-1 border-l border-[var(--border)] pl-2">
          <PrimaryLink to="/tasks" label={t('shell.navTasks')} active={location.pathname === '/tasks'} />
          <PrimaryLink
            to="/settings?section=skills"
            label={t('shell.navSkills')}
            active={location.search.includes('section=skills')}
          />
          <PrimaryLink to="/mcp" label={t('shell.navMcp')} active={location.pathname === '/mcp'} />
        </div>
      ) : null}
    </nav>
  );
}

function PrimaryLink({ to, label, active }: { to: string; label: string; active: boolean }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      onClick={() => navigate(to)}
      className={`w-full rounded-md px-3 py-2 text-left text-sm ${
        active ? 'bg-[var(--accent)] font-medium text-[var(--accent-fg)]' : 'text-[var(--key-fg-dim)] hover:bg-[var(--hover-overlay)]'
      }`}
    >
      {label}
    </button>
  );
}
