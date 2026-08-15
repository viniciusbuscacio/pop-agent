import type { LocalConnectionsResponse } from '@pop-agent/shared';
import { apiRequest } from './api';

export const localAccessService = {
  connections(): Promise<LocalConnectionsResponse> {
    return apiRequest<LocalConnectionsResponse>('/local-tools/connections');
  },
};
