import { describe, it, expect } from 'vitest';
import { RestClientService } from './rest-client-service.js';
import type { IntegrationRepo } from '../ports/integration-repo.js';
import type { RestClient } from '../../domain/integrations/integration.js';
function fixture() {
    let clients: RestClient[] = [];
    const secrets = new Map<string, string>();
    const calls: unknown[] = [];
    const service = new RestClientService({ repo: { clients: () => clients, saveClient: (c: RestClient) => { clients = [...clients.filter(x => x.id !== c.id), c]; }, deleteClient: (id: string) => { clients = clients.filter(c => c.id !== id); } } as IntegrationRepo, secrets: { get: k => secrets.get(k), set: (k, v) => { secrets.set(k, v); }, delete: k => { secrets.delete(k); } }, gateway: { call: async (input) => { calls.push(input); return { status: 200, body: 'Bearer secret and secret' }; } }, now: () => 1 });
    const input = { name: 'External', baseUrl: 'https://api.example.com/v1', enabled: true, authHeader: 'Authorization', operations: [{ id: 'status', name: 'Status', method: 'GET' as const, path: '/status' }] };
    return { service, input, calls, secrets };
}
describe('REST client operations', () => {
    it('keeps credentials out of metadata and response echoes, and only calls registered operations', async () => {
        const f = fixture();
        const c = f.service.save(f.input, undefined, 'Bearer secret');
        expect(JSON.stringify(c)).not.toContain('Bearer secret');
        expect(await f.service.call(c.id, 'status', { q: 'a&b' })).toEqual({ status: 200, body: '[credential redacted] and [credential redacted]' });
        expect(f.calls[0]).toMatchObject({ url: 'https://api.example.com/v1/status?q=a%26b', credential: { name: 'Authorization', value: 'Bearer secret' } });
        await expect(f.service.call(c.id, 'unknown')).rejects.toThrow('operation_not_found');
        f.service.save({ ...f.input, enabled: false }, c.id);
        await expect(f.service.call(c.id, 'status')).rejects.toThrow('client_disabled');
    });
    it('clears credentials when the destination changes and rejects unsafe operation paths', () => {
        const f = fixture();
        const c = f.service.save(f.input, undefined, 'Bearer secret');
        expect(f.service.save({ ...f.input, baseUrl: 'https://other.example' }, c.id).hasCredential).toBe(false);
        for (const path of ['//evil.example', '/../secret', '/%2e%2e/secret', '/test?token=x'])
            expect(() => f.service.save({ ...f.input, operations: [{ ...f.input.operations[0]!, path }] })).toThrow();
        expect(() => f.service.save({ ...f.input, baseUrl: 'http://example.com' })).toThrow('invalid_url');
    });
});
