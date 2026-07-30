import type { AboutResponse, SettingsDTO } from '@popy/shared';
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
};
