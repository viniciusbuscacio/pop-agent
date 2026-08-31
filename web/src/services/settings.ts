import type {
  AboutResponse,
  DeploymentCancelResponse,
  DeploymentRequestResponse,
  PiCandidateActivateResponse,
  PiCandidatePrepareResponse,
  SettingsDTO,
  SettingsPatchDTO,
  UpdateStatusResponse,
  StorageResponse,
  UsageResponse,
  UserMemoryDTO,
} from '@pop-agent/shared';
import { apiRequest } from './api';

export const settingsService = {
  read(): Promise<SettingsDTO> {
    return apiRequest<SettingsDTO>('/settings');
  },

  /** Full replace: the server takes the whole document, never a patch. */
  write(settings: SettingsDTO): Promise<SettingsDTO> {
    return apiRequest<SettingsDTO>('/settings', { method: 'PUT', body: settings });
  },

  /** Merge only the fields owned by the control that changed. */
  update(patch: SettingsPatchDTO): Promise<SettingsDTO> {
    return apiRequest<SettingsDTO>('/settings', { method: 'PATCH', body: patch });
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

  storage(): Promise<StorageResponse> {
    return apiRequest<StorageResponse>('/storage');
  },

  updateStatus(refresh = false): Promise<UpdateStatusResponse> {
    const query = refresh ? '?refresh=1' : '';
    return apiRequest<UpdateStatusResponse>(`/update/status${query}`);
  },

  preparePiCandidate(): Promise<PiCandidatePrepareResponse> {
    return apiRequest<PiCandidatePrepareResponse>('/update/pi/prepare', { method: 'POST' });
  },

  activatePiCandidate(): Promise<PiCandidateActivateResponse> {
    return apiRequest<PiCandidateActivateResponse>('/update/pi/activate', { method: 'POST' });
  },

  restartWhenIdle(): Promise<DeploymentRequestResponse> {
    return apiRequest<DeploymentRequestResponse>('/update/restart-when-idle', { method: 'POST' });
  },

  cancelRestart(): Promise<DeploymentCancelResponse> {
    return apiRequest<DeploymentCancelResponse>('/update/cancel', { method: 'POST' });
  },
};
