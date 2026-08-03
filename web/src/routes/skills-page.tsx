import { t } from '../i18n';
import { SkillsSection } from './settings-page';
import { SidebarNav } from './sidebar-nav';

/**
 * Skills as a pane of the shell, reached from the Agent row in the sidebar.
 *
 * The body is the shared {@link SkillsSection} implementation, so the feature
 * has one editor and one source of truth.
 */
export function SkillsPage() {
  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
      {/* On a phone this pane IS the screen, so it carries the navigation
          itself — exactly what Files does. Without it there is no way back. */}
      <div className="border-b border-[var(--border)] md:hidden">
        <SidebarNav />
      </div>
      <header className="flex items-center gap-3 border-b border-[var(--border)] p-3">
        <h1 className="text-lg font-semibold">{t('shell.navSkills')}</h1>
      </header>
      <div className="mx-auto w-full max-w-3xl p-4">
        <SkillsSection />
      </div>
    </div>
  );
}
