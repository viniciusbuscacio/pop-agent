import type { ServerInfoResponse } from '@pop-agent/shared';
import { apiRequest } from './api';

export const serverService = {
  info(): Promise<ServerInfoResponse> {
    return apiRequest<ServerInfoResponse>('/server/info');
  },

  restart(): Promise<{ ok: true }> {
    return apiRequest<{ ok: true }>('/server/restart', { method: 'POST' });
  },

  stop(): Promise<{ ok: true }> {
    return apiRequest<{ ok: true }>('/server/stop', { method: 'POST' });
  },

  llmStop(): Promise<{ ok: true; interrupted: number }> {
    return apiRequest<{ ok: true; interrupted: number }>('/server/llm-stop', { method: 'POST' });
  },

  llmStart(): Promise<{ ok: true }> {
    return apiRequest<{ ok: true }>('/server/llm-start', { method: 'POST' });
  },
};
