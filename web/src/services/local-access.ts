import type { LocalConnectionsResponse, LocalMachinesResponse } from '@pop-agent/shared';
import { apiRequest } from './api';

export const localAccessService = {
  connections(): Promise<LocalConnectionsResponse> {
    return apiRequest<LocalConnectionsResponse>('/local-tools/connections');
  },

  machines(): Promise<LocalMachinesResponse> {
    return apiRequest<LocalMachinesResponse>('/local-tools/machines');
  },

  remove(machineId: string): Promise<void> {
    return apiRequest(`/local-tools/machines/${encodeURIComponent(machineId)}`, { method: 'DELETE' });
  },

  setEnabled(machineId: string, enabled: boolean): Promise<{ machineId: string; enabled: boolean }> {
    return apiRequest(`/local-tools/machines/${encodeURIComponent(machineId)}`, {
      method: 'PATCH',
      body: { enabled },
    });
  },
};
