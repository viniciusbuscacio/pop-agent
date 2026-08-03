import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { TrashEntryDTO } from '@popy/shared';
import { t } from '../i18n';
import { ApiError } from '../services/api';
import { trashService } from '../services/artifacts';
import { useFilesStore } from '../store/files';
import { useNotificationsStore } from '../store/notifications';
import { Button } from '../ui/controls';
import { PullToRefresh } from '../ui/pull-to-refresh';
import { FolderIcon } from './files-page';
import { SidebarNav } from './sidebar-nav';
import { ShellFooter } from './shell-header';

/**
 * The Files trash (popy.spec §14): what deleting put aside, and the two things
 * you can do about it.
 *
 * Only the top of each deleted subtree is listed -- a folder's own files went
 * in with it and come back with it, so offering to restore one of them alone
 * would be offering something that cannot mean anything. That is decided on
 * the server; this screen just shows what it is given.
 *
 * Every row says how long it has left, in days. A trash that only says
 * "deleted" makes you guess whether it is safe to leave something there, and
 * the whole promise of this screen is the thirty days.
 */
export function TrashPage() {
  const navigate = useNavigate();
  const [entries, setEntries] = useState<TrashEntryDTO[] | undefined>(undefined);
  const [busy, setBusy] = useState<string | undefined>(undefined);
  const reloadFiles = useFilesStore((state) => state.reload);
  const notify = useNotificationsStore((state) => state.notify);

  async function load(): Promise<void> {
    setEntries((await trashService.list()).entries);
  }

  useEffect(() => {
    void load().catch(() => setEntries([]));
  }, []);

  async function restore(entry: TrashEntryDTO): Promise<void> {
    setBusy(entry.id);
    try {
      await trashService.restore(entry.kind, entry.id);
      await Promise.all([load(), reloadFiles()]);
    } catch (error) {
      // The only refusal worth explaining: something took the name while this
      // sat in the trash, and renaming that is a real next step.
      notify(
        error instanceof ApiError && error.code === 'name_taken'
          ? t('trash.nameTaken', { name: entry.name })
          : t('trash.restoreFailed'),
      );
    } finally {
      setBusy(undefined);
    }
  }

  async function purge(entry: TrashEntryDTO): Promise<void> {
    if (!window.confirm(t('trash.purgeConfirm', { name: entry.name }))) return;
    setBusy(entry.id);
    try {
      await trashService.purge(entry.kind, entry.id);
      await load();
    } finally {
      setBusy(undefined);
    }
  }

  async function empty(): Promise<void> {
    if (entries === undefined || entries.length === 0) return;
    if (!window.confirm(t('trash.emptyConfirm', { count: entries.length }))) return;
    await trashService.empty();
    await load();
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="md:hidden">
        <SidebarNav />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3 pb-2">
        <span className="text-base font-semibold">{t('trash.title')}</span>
        <span className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => navigate('/files')}>
            {t('trash.backToFiles')}
          </Button>
          {entries !== undefined && entries.length > 0 ? (
            <Button
              type="button"
              variant="danger"
              size="sm"
              data-testid="trash-empty"
              onClick={() => void empty()}
            >
              {t('trash.empty')}
            </Button>
          ) : null}
        </span>
      </div>
      <p className="px-4 pb-2 text-xs text-[var(--muted)]">{t('trash.intro')}</p>

      <PullToRefresh onRefresh={load} className="pb-20 md:pb-0" testId="trash-list">
        {entries === undefined ? null : entries.length === 0 ? (
          <div className="flex flex-col items-center gap-1 px-4 py-10 text-center">
            <p className="text-sm text-[var(--muted)]">{t('trash.empty.none')}</p>
          </div>
        ) : (
          <ul>
            {entries.map((entry) => (
              <li
                key={`${entry.kind}-${entry.id}`}
                data-testid="trash-row"
                className="flex items-center gap-2 px-4 py-2.5 hover:bg-[var(--hover-overlay)]"
              >
                <div className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                    {/* The drawn icon, never an emoji (permanent house veto). */}
                    {entry.kind === 'folder' ? <FolderIcon /> : null}
                    <span className="truncate">{entry.name}</span>
                  </span>
                  <span className="block truncate text-xs text-[var(--muted)]">
                    {entry.path === '' ? t('files.rootCrumb') : entry.path} ·{' '}
                    {t('trash.daysLeft', { days: daysLeft(entry.purgeAt) })}
                  </span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  data-testid="trash-restore"
                  disabled={busy === entry.id}
                  onClick={() => void restore(entry)}
                >
                  {t('trash.restore')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  data-testid="trash-purge"
                  disabled={busy === entry.id}
                  onClick={() => void purge(entry)}
                >
                  {t('trash.purge')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </PullToRefresh>

      <div className="md:hidden">
        <ShellFooter />
      </div>
    </div>
  );
}

/** Whole days remaining, never negative: a swept-but-not-yet-purged row is 0. */
function daysLeft(purgeAt: string): number {
  const remaining = Date.parse(purgeAt) - Date.now();
  if (Number.isNaN(remaining)) return 0;
  return Math.max(0, Math.ceil(remaining / (24 * 60 * 60 * 1000)));
}
