import { ActionSurface } from '../ui/action-surface';
import { useAgentContextActions } from '../lib/agent-context-actions';
import { Button, Card } from '../ui/controls';
import { AgentPageHeader } from '../ui/agent-page-header';
import { useEffect } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { t } from '../i18n';
import { SkillEditor } from './skill-editor';
import { SidebarNav } from './sidebar-nav';
import { useSkillsStore } from '../store/skills';

/**
 * Skills as the right-hand pane of the shell (docs/specs/Spec-Pop-General.md §8, §14), the explorer
 * layout Chat and Files use: the sidebar carries the list, and this pane shows
 * the skill you picked. No `:slug` shows the overview on a wide screen; `new`
 * starts a blank editor; any other slug edits that skill. On a phone the list
 * is the screen, so this pane only mounts once a skill is open.
 */
export function SkillsPage() {
  const contextActions=useAgentContextActions();
  const navigate = useNavigate();
  const { slug } = useParams();
  const location = useLocation();
  const skills = useSkillsStore((state) => state.skills);
  const reload = useSkillsStore((state) => state.reload);

  useEffect(() => {
    void reload();
  }, [reload]);

  const isNew = location.pathname === '/skills/new' || slug === 'new';
  const skill = isNew ? undefined : skills?.find((entry) => entry.slug === slug);

  // A dead link (a deleted skill) falls back to the list once skills arrived.
  useEffect(() => {
    if (!isNew && slug !== undefined && skills !== undefined && skill === undefined) {
      void navigate('/skills', { replace: true });
    }
  }, [isNew, slug, skills, skill, navigate]);

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
      {/* The phone's copy of the nav, with no rule under it -- the sidebar's
          copy has none, so the line only ever showed on the pane screens. */}
      <div className="md:hidden">
        <SidebarNav />
      </div>
      {slug === undefined && !isNew ? (
        <ActionSurface actions={[{id:'new',label:t('context.new'),run:()=>{void navigate('/skills/new');}},{id:'refresh',label:t('context.refresh'),run:()=>reload()}]} ><div className="p-6">
          <AgentPageHeader title={t('agent.skillsTitle')} description={t('agent.skillsDescription')} />
          {skills === undefined ? <p className="text-sm text-[var(--muted)]">{t('app.loading')}</p> : skills.length === 0 ? <p className="text-sm text-[var(--muted)]">{t('skills.empty.body')}</p> :
            <div className="grid gap-3">{skills.map(entry => <ActionSurface key={entry.slug} actions={contextActions.skill(entry)}><Card className="flex items-center justify-between gap-4 pr-10">
              <div className="min-w-0">
                <div className="break-words font-medium">{entry.name}</div>
                <p className="text-sm text-[var(--muted)]">{entry.description}</p>
              </div>
              <Button variant="ghost" onClick={() => void navigate('/skills/' + encodeURIComponent(entry.slug))}>{t('common.edit')}</Button>
            </Card></ActionSurface>)}</div>}
        </div></ActionSurface>
      ) : isNew || skill !== undefined ? (
        <div className="w-full p-6">
          <SkillEditor
            skill={skill}
            onDone={() => {
              void reload();
              void navigate('/skills');
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
