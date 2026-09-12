import type { RestApiSettingsDTO, RestApiKeyDTO, RestApiAllowedIpsDTO, RestClientDTO, IntegrationReferenceDTO } from '@pop-agent/shared';
import { apiRequest } from './api';
export const integrationsService = {
    allowedIps: () => apiRequest<RestApiAllowedIpsDTO>('/rest-api/allowed-ips'),
    setAllowedIps: (entries: string[]) => apiRequest<RestApiAllowedIpsDTO>('/rest-api/allowed-ips', { method: 'PUT', body: { entries } }),
    accessKey: () => apiRequest<RestApiKeyDTO>('/rest-api/key'),
    rotateAccessKey: () => apiRequest<RestApiKeyDTO>('/rest-api/key', { method: 'POST' }),
    settings: readSettings,
    updateSettings: async (body: Partial<RestApiSettingsDTO>) => {
        ++settingsRevision;
        const value = await apiRequest<RestApiSettingsDTO>('/rest-api/settings', { method: 'PATCH', body });
        ++settingsRevision;
        publishServerEnabled(value.serverEnabled);
        return value;
    },
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
    reference: () => apiRequest<IntegrationReferenceDTO>('/rest-api/reference'),
    test: () => apiRequest<{
        ok: boolean;
    }>('/rest-api/health'),
};

let serverEnabled: boolean | undefined;
let settingsRevision = 0;
const statusListeners = new Set<() => void>();
let statusTimer: ReturnType<typeof setInterval> | undefined;
function publishServerEnabled(value: boolean | undefined): void {
    if (serverEnabled === value) return;
    serverEnabled = value;
    statusListeners.forEach(listener => listener());
}
async function readSettings(): Promise<RestApiSettingsDTO> {
    const revision = ++settingsRevision;
    try {
        const value = await apiRequest<RestApiSettingsDTO>('/rest-api/settings');
        if (revision === settingsRevision) publishServerEnabled(value.serverEnabled);
        return value;
    } catch (error) {
        if (revision === settingsRevision) publishServerEnabled(undefined);
        throw error;
    }
}
function refreshServerStatus(): void {
    if (document.visibilityState === 'hidden') return;
    void readSettings().catch(() => undefined);
}
/** One shared refresh loop for desktop and mobile shell copies. */
export const restApiStatus = {
    getState: (): boolean | undefined => serverEnabled,
    subscribe: (listener: () => void): (() => void) => {
        statusListeners.add(listener);
        if (statusListeners.size === 1) {
            refreshServerStatus();
            statusTimer = setInterval(refreshServerStatus, 60_000);
            document.addEventListener('visibilitychange', refreshServerStatus);
            window.addEventListener('online', refreshServerStatus);
        }
        return () => {
            statusListeners.delete(listener);
            if (statusListeners.size === 0) {
                clearInterval(statusTimer);
                document.removeEventListener('visibilitychange', refreshServerStatus);
                window.removeEventListener('online', refreshServerStatus);
                ++settingsRevision;
                serverEnabled = undefined;
            }
        };
    },
};
