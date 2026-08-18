import { useLocation, useNavigate } from 'react-router-dom';
import { t } from '../i18n';
import { Segmented } from '../ui/controls';

type MainSection = 'chat' | 'files' | 'agent';
type AgentSection = 'tasks' | 'skills' | 'mcp';

/** The two-level segmented navigation shared by the sidebar and mobile Files view. */
export function SidebarNav() {
  const navigate = useNavigate();
  const location = useLocation();
  // Every Agent destination is a route of its own inside the shell, so which
  // one is current is read off the path alone -- no query string, and nothing
  // that can be true on a screen where this nav is not even mounted.
  //
  // An open item counts as its section: matching the bare path only meant that
  // opening a skill (/skills/know-thyself) or a task (/tasks/new) dropped the
  // highlight back onto Chat, which is not even where you were (Vinicius,
  // 03/08).
  const AGENT_SECTIONS: AgentSection[] = ['tasks', 'skills', 'mcp'];
  const agentSection = AGENT_SECTIONS.find(
    (section) =>
      location.pathname === `/${section}` || location.pathname.startsWith(`/${section}/`),
  );
  const mainSection: MainSection = location.pathname.startsWith('/files')
    ? 'files'
    : agentSection !== undefined
      ? 'agent'
      : 'chat';

  function selectMain(value: MainSection): void {
    if (value === 'files') {
      void navigate('/files');
    } else if (value === 'agent') {
      void navigate('/tasks');
    } else {
      void navigate('/');
    }
  }

  function selectAgent(value: AgentSection): void {
    void navigate(`/${value}`);
  }

  return (
    <div className="flex flex-col gap-2 px-3 pt-3" data-testid="sidebar-navigation">
      <Segmented<MainSection>
        ariaLabel={t('shell.navigation')}
        value={mainSection}
        onChange={selectMain}
        bold
        options={[
          { value: 'chat', label: t('shell.navChat'), testId: 'sidebar-chat' },
          { value: 'files', label: t('shell.navFiles'), testId: 'sidebar-files' },
          { value: 'agent', label: t('shell.navAgent'), testId: 'sidebar-agent' },
        ]}
      />
      {mainSection === 'agent' && agentSection !== undefined ? (
        <Segmented<AgentSection>
          ariaLabel={t('shell.agentNavigation')}
          value={agentSection}
          onChange={selectAgent}
          options={[
            { value: 'tasks', label: t('shell.navTasks'), testId: 'sidebar-tasks' },
            { value: 'skills', label: t('shell.navSkills'), testId: 'sidebar-skills' },
            { value: 'mcp', label: t('shell.navMcp'), testId: 'sidebar-mcp' },
          ]}
        />
      ) : null}
    </div>
  );
}
