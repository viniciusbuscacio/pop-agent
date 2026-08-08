import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { t } from '../i18n';
import { SkillEditor } from './skill-editor';
import { SidebarNav } from './sidebar-nav';
import { useSkillsStore } from '../store/skills';

/**
 * Skills as the right-hand pane of the shell (pop-agent.spec §8, §14), the explorer
 * layout Chat and Files use: the sidebar carries the list, and this pane shows
 * the skill you picked. No `:slug` is the empty pane on a wide screen; `new`
 * starts a blank editor; any other slug edits that skill. On a phone the list
 * is the screen, so this pane only mounts once a skill is open.
 */
export function SkillsPage() {
  const navigate = useNavigate();
  const { slug } = useParams();
  const skills = useSkillsStore((state) => state.skills);
  const reload = useSkillsStore((state) => state.reload);

  useEffect(() => {
    void reload();
  }, [reload]);

  const isNew = slug === 'new';
  const skill = isNew ? undefined : skills?.find((entry) => entry.slug === slug);

  // A dead link (a deleted skill) falls back to the list once skills arrived.
  useEffect(() => {
    if (!isNew && slug !== undefined && skills !== undefined && skill === undefined) {
      navigate('/skills', { replace: true });
    }
  }, [isNew, slug, skills, skill, navigate]);

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
      {/* The phone's copy of the nav, with no rule under it -- the sidebar's
          copy has none, so the line only ever showed on the pane screens. */}
      <div className="md:hidden">
        <SidebarNav />
      </div>
      {slug === undefined ? (
        <div className="flex flex-1 items-center justify-center p-8">
          <div className="max-w-sm text-center">
            <h1 className="text-lg font-semibold">{t('skills.empty.title')}</h1>
            <p className="mt-2 text-sm text-[var(--muted)]">{t('skills.empty.body')}</p>
          </div>
        </div>
      ) : isNew || skill !== undefined ? (
        <div className="mx-auto w-full max-w-3xl p-4">
          <SkillEditor
            skill={skill}
            onDone={() => {
              void reload();
              navigate('/skills');
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
