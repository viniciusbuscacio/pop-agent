import { t } from '../i18n';
import { filesService } from '../services/artifacts';
import { joinPath, useFilesStore } from '../store/files';

/** Both file explorers create a folder inside the currently open directory. */
export async function promptNewFolder(currentPath: string): Promise<void> {
  const name = window.prompt(currentPath ? t('files.newSubfolderPrompt') : t('files.newFolderPrompt'));
  if (name === null || name.trim().length === 0) return;
  await filesService.mkdir(joinPath(currentPath, name.trim()));
  await useFilesStore.getState().reload();
}
