import type { BackupDTO, BackupsResponse } from '@pop-agent/shared';
import { apiDownload, apiRequest } from './api';

export const backupsService = {
  list(): Promise<BackupsResponse> {
    return apiRequest<BackupsResponse>('/backups');
  },

  create(): Promise<BackupDTO> {
    return apiRequest<BackupDTO>('/backups', { method: 'POST' });
  },

  restore(name: string): Promise<{ restartRequired: boolean }> {
    return apiRequest<{ restartRequired: boolean }>(`/backups/${name}/restore`, { method: 'POST' });
  },

  remove(name: string): Promise<void> {
    return apiRequest<void>(`/backups/${name}`, { method: 'DELETE' });
  },

  /** Fetches the archive as a Blob (auth in the header, not the URL). */
  download(name: string): Promise<Blob> {
    return apiDownload(`/backups/${name}/download`);
  },
};
