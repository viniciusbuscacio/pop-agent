import type { A2aModuleSettingsDTO } from '@pop-agent/shared';
import { apiRequest } from './api';
export const a2aModuleService = {
  settings: readSettings,
  update: async (patch: Partial<A2aModuleSettingsDTO>) => {
    ++settingsRevision;
    const value = await apiRequest<A2aModuleSettingsDTO>('/a2a/settings', { method: 'PATCH', body: patch });
    ++settingsRevision; publishServerEnabled(value.serverEnabled); return value;
  },
  test: () => apiRequest<{ ok: boolean }>('/a2a/server/health'),
  card: () => apiRequest<Record<string, unknown>>('/a2a/server/card'),
  accessKey: () => apiRequest<{ secret: string }>('/a2a/server/key'),
  rotateAccessKey: () => apiRequest<{ secret: string }>('/a2a/server/key', { method: 'POST' }),
  allowedIps: () => apiRequest<{ entries: string[] }>('/a2a/server/allowed-ips'),
  setAllowedIps: (entries: string[]) => apiRequest<{ entries: string[] }>('/a2a/server/allowed-ips', { method: 'PUT', body: { entries } }),
  outboundIps: () => apiRequest<{ entries: string[] }>('/a2a/client/allowed-ips'),
  setOutboundIps: (entries: string[]) => apiRequest<{ entries: string[] }>('/a2a/client/allowed-ips', { method: 'PUT', body: { entries } }),
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
async function readSettings(): Promise<A2aModuleSettingsDTO> {
    const revision = ++settingsRevision;
    try {
        const value = await apiRequest<A2aModuleSettingsDTO>('/a2a/settings');
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
export const a2aStatus = {
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
