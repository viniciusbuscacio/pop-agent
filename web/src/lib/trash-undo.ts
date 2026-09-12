import type { GarbageEntryDTO } from '@pop-agent/shared';
import { t } from '../i18n';
import { trashService } from '../services/artifacts';
import { useFilesStore } from '../store/files';
import { useNotificationsStore } from '../store/notifications';

/**
 * Turns a completed move to Trash into a short, global undo opportunity.
 * The server-provided Garbage names are the handles: visible basenames are not
 * safe because two deleted entries may have collided and been renamed there.
 */
export function useTrashUndo(): (entries: GarbageEntryDTO[]) => void {
  const reload = useFilesStore((state) => state.reload);
  const notify = useNotificationsStore((state) => state.notify);

  return (entries) => {
    if (entries.length === 0) return;
    const snapshot = [...entries];
    const message =
      snapshot.length === 1
        ? t('trash.moved', { name: snapshot[0]?.originalPath ?? '' })
        : t('trash.movedMany', { count: snapshot.length });

    notify(message, {
      label: t('trash.restore'),
      run: async () => {
        let failed = 0;
        // Deletion removes files before their selected parent folders. Reverse
        // order recreates the parent first, then puts its selected files back.
        for (const entry of snapshot.reverse()) {
          try {
            await trashService.restore(entry.name);
          } catch {
            failed += 1;
          }
        }
        await reload();
        if (failed === 0) {
          notify(
            snapshot.length === 1
              ? t('trash.restoredOne')
              : t('trash.restoredMany', { count: snapshot.length }),
          );
        } else {
          notify(t('trash.undoFailed', { count: failed }));
        }
      },
    });
  };
}
