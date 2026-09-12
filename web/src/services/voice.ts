import { apiRequest } from './api';

export interface VoiceModelStatus {
  name: string;
  approxMb: number;
  installed: boolean;
}

export const voiceService = {
  models(): Promise<{ models: VoiceModelStatus[]; selected: string }> {
    return apiRequest('/voice/models');
  },

  /** Downloads the model if needed and makes it the default. */
  select(name: string): Promise<{ selected: string }> {
    return apiRequest(`/voice/models/${name}`, { method: 'POST' });
  },
};
