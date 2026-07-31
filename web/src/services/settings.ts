import type { AboutResponse, SettingsDTO, UsageResponse, UserMemoryDTO } from '@popy/shared';
import { apiRequest } from './api';

export const settingsService = {
  read(): Promise<SettingsDTO> {
    return apiRequest<SettingsDTO>('/settings');
  },

  /** Full replace: the server takes the whole document, never a patch. */
  write(settings: SettingsDTO): Promise<SettingsDTO> {
    return apiRequest<SettingsDTO>('/settings', { method: 'PUT', body: settings });
  },

  about(): Promise<AboutResponse> {
    return apiRequest<AboutResponse>('/about');
  },

  readMemory(): Promise<UserMemoryDTO> {
    return apiRequest<UserMemoryDTO>('/memory');
  },

  writeMemory(doc: string): Promise<UserMemoryDTO> {
    return apiRequest<UserMemoryDTO>('/memory', { method: 'PUT', body: { doc } });
  },

  restoreMemory(): Promise<UserMemoryDTO> {
    return apiRequest<UserMemoryDTO>('/memory/restore', { method: 'POST' });
  },

  usage(): Promise<UsageResponse> {
    return apiRequest<UsageResponse>('/usage');
  },
};
