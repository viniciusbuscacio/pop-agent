export const INTEGRATION_SCOPES = ['activity:read', 'conversations:read', 'conversations:write', 'runs:cancel', 'ui:control'] as const;
export type IntegrationScope = typeof INTEGRATION_SCOPES[number];
export interface IntegrationToken {
    id: string;
    name: string;
    scopes: IntegrationScope[];
    createdAt: number;
    expiresAt: number;
    lastUsedAt: number | null;
    revokedAt: number | null;
}
export interface IntegrationActivity {
    runId: string;
    chatId: string;
    state: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'unknown';
    phase: 'unknown' | 'model' | 'tool' | 'subagent' | 'finished';
    updatedAt: number;
    startedAt: number;
    tool: {
        name: string;
        status: string;
    } | null;
    messageId: string | null;
    queueId: string | null;
}
export interface IntegrationEvent {
    cursor: number;
    activity: IntegrationActivity;
}
export class IntegrationError extends Error {
    constructor(readonly status: 400 | 401 | 403 | 404 | 409 | 429 | 503, readonly code: string) { super(code); }
}
export interface RestOperation {
    id: string;
    name: string;
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    path: string;
}
export interface RestClient {
    id: string;
    name: string;
    baseUrl: string;
    enabled: boolean;
    authHeader: string;
    hasCredential: boolean;
    operations: RestOperation[];
    updatedAt: number;
}
