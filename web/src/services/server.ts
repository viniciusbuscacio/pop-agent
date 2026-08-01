import type { ServerInfoResponse } from '@popy/shared';
import { apiRequest } from './api';

export const serverService = {
  info(): Promise<ServerInfoResponse> {
    return apiRequest<ServerInfoResponse>('/server/info');
  },
};
