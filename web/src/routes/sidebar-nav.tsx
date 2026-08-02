import { useLocation, useNavigate } from 'react-router-dom';
import { t } from '../i18n';
import { Segmented } from '../ui/controls';

type MainSection = 'chat' | 'files' | 'agent';
type AgentSection = 'tasks' | 'skills' | 'mcp';

/** The two-level segmented navigation shared by the sidebar and mobile Files view. */
export function SidebarNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const agentSection: AgentSection =
    location.pathname === '/tasks'
      ? 'tasks'
      : location.pathname === '/mcp'
        ? 'mcp'
        : 'skills';
  const mainSection: MainSection =
    location.pathname.startsWith('/files')
      ? 'files'
      : location.pathname === '/tasks' || location.pathname === '/mcp' || location.search.includes('section=skills')
        ? 'agent'
        : 'chat';

  function selectMain(value: MainSection): void {
    if (value === 'files') {
      navigate('/files');
    } else if (value === 'agent') {
      navigate('/tasks');
    } else {
      navigate('/');
    }
  }

  function selectAgent(value: AgentSection): void {
    if (value === 'tasks') navigate('/tasks');
    if (value === 'skills') navigate('/settings?section=skills');
    if (value === 'mcp') navigate('/mcp');
  }

  return (
    <div className="flex flex-col gap-2 px-3 pt-3" data-testid="sidebar-navigation">
      <Segmented<MainSection>
        ariaLabel={t('shell.navigation')}
        value={mainSection}
        onChange={selectMain}
        options={[
          { value: 'chat', label: t('shell.navChat'), testId: 'sidebar-chat' },
          { value: 'files', label: t('shell.navFiles'), testId: 'sidebar-files' },
          { value: 'agent', label: t('shell.navAgent'), testId: 'sidebar-agent' },
        ]}
      />
      {mainSection === 'agent' ? (
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
