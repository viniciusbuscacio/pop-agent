import type {
  A2aAgentResponse,
  A2aAgentsResponse,
  A2aTaskResponse,
  A2aTasksResponse,
  A2aTestResponse,
} from '@pop-agent/shared';
import { apiRequest } from './api';

/** Outbound Agent-to-Agent connections over the product API. */
export const a2aService = {
  list: () => apiRequest<A2aAgentsResponse>('/a2a/agents'),
  create: (body: unknown) =>
    apiRequest<A2aAgentResponse>('/a2a/agents', { method: 'POST', body }),
  update: (id: string, body: unknown) =>
    apiRequest<A2aAgentResponse>(`/a2a/agents/${id}`, { method: 'PUT', body }),
  remove: (id: string) => apiRequest<void>(`/a2a/agents/${id}`, { method: 'DELETE' }),
  test: (id: string) =>
    apiRequest<A2aTestResponse>(`/a2a/agents/${id}/test`, { method: 'POST' }),
  toggle: (id: string) =>
    apiRequest<A2aAgentResponse>(`/a2a/agents/${id}/toggle`, { method: 'POST' }),
  tasks: (agentId: string) =>
    apiRequest<A2aTasksResponse>(`/a2a/tasks?agentId=${encodeURIComponent(agentId)}`),
  send: (agentId: string, text: string) =>
    apiRequest<A2aTaskResponse>(`/a2a/agents/${encodeURIComponent(agentId)}/messages`, {
      method: 'POST',
      body: { text },
    }),
  task: (id: string) => apiRequest<A2aTaskResponse>(`/a2a/tasks/${encodeURIComponent(id)}`),
  cancel: (id: string) => apiRequest<A2aTaskResponse>(
    `/a2a/tasks/${encodeURIComponent(id)}/cancel`,
    { method: 'POST' },
  ),
  continue: (id: string, text: string) => apiRequest<A2aTaskResponse>(
    `/a2a/tasks/${encodeURIComponent(id)}/continue`,
    { method: 'POST', body: { text } },
  ),
};
