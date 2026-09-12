import type { BackupDTO, BackupsResponse } from '@pop-agent/shared';
import { apiDownload, apiRequest } from './api';

export const backupsService = {
  setPassword(password: string, confirmation: string): Promise<void> {
    return apiRequest<void>('/backups/password', { method: 'PUT', body: { password, confirmation } });
  },
  list(): Promise<BackupsResponse> {
    return apiRequest<BackupsResponse>('/backups');
  },

  create(includeFiles = true): Promise<BackupDTO> {
    return apiRequest<BackupDTO>('/backups', { method: 'POST', body: { includeFiles } });
  },

  restore(name: string, password?: string): Promise<{ accepted: boolean }> {
    return apiRequest<{ accepted: boolean }>(`/backups/${encodeURIComponent(name)}/restore`, {
      method: 'POST', body: { confirm: true, ...(password === undefined ? {} : { password }) },
    });
  },

  remove(name: string): Promise<void> {
    return apiRequest<void>(`/backups/${name}`, { method: 'DELETE' });
  },

  /** Fetches the archive as a Blob (auth in the header, not the URL). */
  download(name: string): Promise<Blob> {
    return apiDownload(`/backups/${name}/download`);
  },
};
