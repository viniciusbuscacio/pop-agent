import type { RestApiSettingsDTO, RestClientDTO, IntegrationTokenDTO, IntegrationScopeDTO, IntegrationReferenceDTO } from '@pop-agent/shared';
import { apiRequest } from './api';
export const integrationsService = {
    settings: () => apiRequest<RestApiSettingsDTO>('/rest-api/settings'),
    updateSettings: (body: Partial<RestApiSettingsDTO>) => apiRequest<RestApiSettingsDTO>('/rest-api/settings', { method: 'PATCH', body }),
    clients: () => apiRequest<{
        clients: RestClientDTO[];
    }>('/rest-api/clients'),
    saveClient: (input: Omit<RestClientDTO, 'id' | 'hasCredential' | 'updatedAt'> & {
        credential?: string;
    }, id?: string) => apiRequest<{
        client: RestClientDTO;
    }>(id ? `/rest-api/clients/${encodeURIComponent(id)}` : '/rest-api/clients', { method: id ? 'PUT' : 'POST', body: input }),
    deleteClient: (id: string) => apiRequest<{
        ok: boolean;
    }>(`/rest-api/clients/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    callClient: (id: string, operationId: string, query: Record<string, string>, body?: unknown) => apiRequest<{
        status: number;
        body: string;
    }>(`/rest-api/clients/${encodeURIComponent(id)}/call`, { method: 'POST', body: { operationId, query, ...(body === undefined ? {} : { body }) } }),
    list: () => apiRequest<{
        tokens: IntegrationTokenDTO[];
    }>('/rest-api/tokens'),
    create: (name: string, scopes: IntegrationScopeDTO[], days: number) => apiRequest<{
        token: IntegrationTokenDTO;
        secret: string;
    }>('/rest-api/tokens', { method: 'POST', body: { name, scopes, days } }),
    revoke: (id: string) => apiRequest<{
        ok: boolean;
    }>(`/rest-api/tokens/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    reference: () => apiRequest<IntegrationReferenceDTO>('/rest-api/reference'),
    test: () => apiRequest<{
        ok: boolean;
    }>('/rest-api/health'),
};
