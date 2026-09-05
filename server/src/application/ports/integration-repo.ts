import type { RestClient, IntegrationActivity, IntegrationEvent, IntegrationToken } from '../../domain/integrations/integration.js';
export interface IntegrationRepo {
    clients(): RestClient[];
    saveClient(client: RestClient): void;
    deleteClient(id: string): void;
    tokens(): IntegrationToken[];
    token(hash: string): IntegrationToken | undefined;
    saveToken(token: IntegrationToken, hash: string): void;
    revoke(id: string, now: number): void;
    used(id: string, now: number): void;
    once(tokenId: string, key: string, hash: string, now: number, action: () => Record<string, unknown>): Record<string, unknown>;
    activity(runId: string): IntegrationActivity | undefined;
    activities(offset: number, limit: number): IntegrationActivity[];
    observe(activity: IntegrationActivity): void;
    events(after: number): IntegrationEvent[];
    cursorRange(): {
        oldest: number;
        latest: number;
    };
    audit(tokenId: string, operation: string, target: string, now: number): void;
    prune(now: number): void;
}
