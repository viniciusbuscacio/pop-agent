import { create } from 'zustand';
import type { ArtifactDTO, FolderDTO } from '@popy/shared';
import { artifactsService, foldersService } from '../services/artifacts';

/**
 * Files and folders, shared between the sidebar tree and the content pane so
 * an upload or a delete on one side is reflected on the other at once.
 */
interface FilesState {
  files: ArtifactDTO[] | undefined;
  folders: FolderDTO[];
  reload: () => Promise<void>;
}

export const useFilesStore = create<FilesState>((set) => ({
  files: undefined,
  folders: [],
  reload: async () => {
    try {
      const [{ artifacts }, { folders }] = await Promise.all([
        artifactsService.listAll(),
        foldersService.list(),
      ]);
      set({ files: artifacts, folders });
    } catch {
      set({ files: [], folders: [] });
    }
  },
}));
