import { randomUUID } from 'node:crypto';
import { IntegrationError, type RestClient } from '../../domain/integrations/integration.js';
import type { IntegrationRepo } from '../ports/integration-repo.js';
import type { SecretsRepo } from '../ports/secrets-repo.js';
import type { RestGateway } from '../ports/rest-gateway.js';
export class RestClientService {
    constructor(private readonly deps: {
        repo: IntegrationRepo;
        secrets: SecretsRepo;
        gateway: RestGateway;
        now: () => number;
    }) { }
    list(): RestClient[] { return this.deps.repo.clients(); }
    save(input: Omit<RestClient, 'id' | 'hasCredential' | 'updatedAt'>, id?: string, credential?: string): RestClient {
        let url: URL;
        try {
            url = new URL(input.baseUrl);
        }
        catch {
            throw new IntegrationError(400, 'invalid_url');
        }
        if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
            throw new IntegrationError(400, 'invalid_url');
        if (!input.name.trim() || input.name.length > 80 || input.operations.length < 1 || input.operations.length > 30)
            throw new IntegrationError(400, 'invalid_client');
        if (input.authHeader !== '' && input.authHeader.toLowerCase() !== 'authorization' && !/^x-[a-z0-9-]{1,60}$/iu.test(input.authHeader))
            throw new IntegrationError(400, 'invalid_credential_header');
        const ids = new Set<string>();
        for (const operation of input.operations) {
            if (!/^[a-z][a-z0-9_-]{0,63}$/u.test(operation.id) || ids.has(operation.id) || !operation.path.startsWith('/') || operation.path.startsWith('//') || /[?#\\]/u.test(operation.path) || !['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(operation.method))
                throw new IntegrationError(400, 'invalid_operation');
            const target = new URL(url.toString().replace(/\/$/u, '') + operation.path);
            if (target.origin !== url.origin || /(?:^|\/)(?:\.|%2e){1,2}(?:\/|$)/iu.test(operation.path))
                throw new IntegrationError(400, 'invalid_operation');
            ids.add(operation.id);
        }
        const previous = id === undefined ? undefined : this.list().find(c => c.id === id);
        if (id !== undefined && !previous)
            throw new IntegrationError(404, 'client_not_found');
        if (id === undefined && this.list().length >= 100)
            throw new IntegrationError(409, 'client_limit');
        if (credential !== undefined && (credential.length > 4096 || /[\r\n]/u.test(credential)))
            throw new IntegrationError(400, 'invalid_credential');
        const clientId = id ?? randomUUID();
        const key = `rest-client.${clientId}.credential`;
        // Changing origin/header never silently carries an old credential to another destination.
        const changed = previous !== undefined && (new URL(previous.baseUrl).origin !== url.origin || previous.authHeader !== input.authHeader);
        if (changed || credential === '')
            this.deps.secrets.delete(key);
        if (credential !== undefined && credential !== '')
            this.deps.secrets.set(key, credential);
        const result: RestClient = { ...input, id: clientId, baseUrl: url.toString().replace(/\/$/u, ''), hasCredential: this.deps.secrets.get(key) !== undefined, updatedAt: this.deps.now() };
        this.deps.repo.saveClient(result);
        return result;
    }
    delete(id: string): void { this.deps.repo.deleteClient(id); this.deps.secrets.delete(`rest-client.${id}.credential`); }
    async call(id: string, operationId: string, query: Record<string, string> = {}, body?: unknown, signal?: AbortSignal): Promise<{
        status: number;
        body: string;
    }> {
        const client = this.list().find(c => c.id === id);
        if (!client)
            throw new IntegrationError(404, 'client_not_found');
        if (!client.enabled)
            throw new IntegrationError(409, 'client_disabled');
        const operation = client.operations.find(o => o.id === operationId);
        if (!operation)
            throw new IntegrationError(404, 'operation_not_found');
        if (operation.method === 'GET' && body !== undefined)
            throw new IntegrationError(400, 'get_body_not_allowed');
        const url = new URL(client.baseUrl + operation.path);
        for (const [key, value] of Object.entries(query))
            url.searchParams.set(key, value);
        if (url.toString().length > 8192)
            throw new IntegrationError(400, 'request_too_large');
        const serialized = body === undefined ? undefined : JSON.stringify(body);
        if (serialized !== undefined && Buffer.byteLength(serialized) > 128 * 1024)
            throw new IntegrationError(400, 'request_too_large');
        const secret = this.deps.secrets.get(`rest-client.${id}.credential`);
        if (client.authHeader && !secret)
            throw new IntegrationError(409, 'credential_required');
        try {
            const result = await this.deps.gateway.call({ url: url.toString(), method: operation.method, ...(serialized === undefined ? {} : { body: serialized }), ...(secret && client.authHeader ? { credential: { name: client.authHeader, value: secret } } : {}), ...(signal === undefined ? {} : { signal }) });
            // A remote echo must not expose the stored credential back to the model or owner UI.
            const sensitive = secret === undefined ? [] : [...new Set([secret, secret.replace(/^Bearer\s+/iu, '')])].filter(value => value.length > 0);
            const cleanBody = sensitive.reduce((text, value) => text.split(value).join('[credential redacted]'), result.body);
            return { ...result, body: cleanBody };
        }
        catch {
            throw new IntegrationError(503, signal?.aborted ? 'request_cancelled' : 'remote_request_failed');
        }
    }
}
