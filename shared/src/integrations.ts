export type IntegrationScopeDTO = 'activity:read' | 'conversations:read' | 'conversations:write' | 'runs:cancel';
export interface IntegrationTokenDTO {
    id: string;
    name: string;
    scopes: IntegrationScopeDTO[];
    createdAt: number;
    expiresAt: number;
    lastUsedAt: number | null;
    revokedAt: number | null;
}
export interface IntegrationReferenceDTO {
    endpoints: {
        method: string;
        path: string;
        scope: string;
        summary: string;
    }[];
    openapi: Record<string, unknown>;
}
export interface RestOperationDTO {
    id: string;
    name: string;
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    path: string;
}
export interface RestClientDTO {
    id: string;
    name: string;
    baseUrl: string;
    enabled: boolean;
    authHeader: string;
    hasCredential: boolean;
    operations: RestOperationDTO[];
    updatedAt: number;
}

export interface IntegrationActivityDTO {
  runId:string; chatId:string; state:'queued'|'running'|'completed'|'failed'|'cancelled'|'unknown';
  phase:'unknown'|'model'|'tool'|'subagent'|'finished'; updatedAt:number; startedAt:number;
  tool:{name:string;status:string}|null; messageId:string|null; queueId:string|null;
}

export interface RestApiSettingsDTO {
  serverEnabled: boolean;
  clientEnabled: boolean;
}
