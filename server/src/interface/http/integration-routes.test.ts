import { describe, it, expect } from 'vitest';
import { createTestApp, setupTestSession } from '../../testing/app-fixture.js';
import type { IntegrationScope } from '../../domain/integrations/integration.js';
import { integrationOpenApi, INTEGRATION_ENDPOINTS } from './integration-routes.js';
const auth = (token: string) => ({ Authorization: `Bearer ${token}`, 'content-type': 'application/json' });
async function fixture(scopes: IntegrationScope[] = ['activity:read']) {
    const f = createTestApp();
    const owner = await setupTestSession(f.app);
    const response = await f.app.request('/v1/rest-api/tokens', { method: 'POST', headers: auth(owner), body: JSON.stringify({ name: 'test integration', scopes, days: 7 }) });
    expect(response.status).toBe(201);
    const token = await response.json() as {
        secret: string;
        token: {
            id: string;
        };
    };
    return { ...f, owner, ...token };
}
describe('REST integration authorization and commands', () => {
    it('only reveals the bearer on creation and isolates it from administration and content', async () => {
        const f = await fixture();
        const list = await f.app.request('/v1/rest-api/tokens', { headers: auth(f.owner) });
        expect(await list.text()).not.toContain(f.secret);
        expect((await f.app.request('/v1/integration/activity', { headers: auth(f.secret) })).status).toBe(200);
        for (const path of ['/v1/rest-api/tokens', '/v1/settings', '/v1/chats', '/v1/rest-api/clients'])
            expect((await f.app.request(path, { headers: auth(f.secret) })).status).toBe(401);
        expect((await f.app.request('/v1/integration/conversations', { headers: auth(f.secret) })).status).toBe(403);
        expect((await f.app.request('/v1/integration/conversations', { method: 'POST', headers: { ...auth(f.secret), 'Idempotency-Key': 'one' } })).status).toBe(403);
        await f.app.request(`/v1/rest-api/tokens/${f.token.id}`, { method: 'DELETE', headers: auth(f.owner) });
        expect((await f.app.request('/v1/integration/activity', { headers: auth(f.secret) })).status).toBe(401);
        expect((await f.app.request('/v1/rest-api/tokens', { headers: auth(f.owner) })).status).toBe(200);
    });
    it('makes creation and sends idempotent and does not grant content access with write scope', async () => {
        const f = await fixture(['conversations:write']);
        const create = () => f.app.request('/v1/integration/conversations', { method: 'POST', headers: { ...auth(f.secret), 'Idempotency-Key': 'create' } });
        const first = await (await create()).json() as {
            chatId: string;
        };
        expect(await (await create()).json()).toEqual(first);
        const send = (text: string) => f.app.request(`/v1/integration/conversations/${first.chatId}/messages`, { method: 'POST', headers: { ...auth(f.secret), 'Idempotency-Key': 'send' }, body: JSON.stringify({ text }) });
        const accepted = await send('hello');
        expect(accepted.status).toBe(202);
        const result = await accepted.json();
        expect(await (await send('hello')).json()).toEqual(result);
        expect((await send('different')).status).toBe(409);
        expect((await f.app.request(`/v1/integration/conversations/${first.chatId}/messages`, { headers: auth(f.secret) })).status).toBe(403);
    });
    it('projects activity without content or tool arguments and persists terminal status', async () => {
        const f = await fixture();
        f.hub.emit({ kind: 'run-status', chatId: 'chat-test', runId: 'run-test', status: 'running' });
        f.hub.emit({ kind: 'tool', chatId: 'chat-test', runId: 'run-test', seq: 1, name: 'delegate_worker', status: 'start', detail: 'private prompt and credentials' });
        f.hub.emit({ kind: 'delta', chatId: 'chat-test', runId: 'run-test', seq: 2, text: 'private response' });
        const response = await f.app.request('/v1/integration/runs/run-test', { headers: auth(f.secret) });
        const body = await response.text();
        expect(body).not.toContain('private');
        expect(body).toContain('subagent');
        f.hub.emit({ kind: 'done', chatId: 'chat-test', runId: 'run-test', messageId: 'message-test' });
        expect(await (await f.app.request('/v1/integration/runs/run-test', { headers: auth(f.secret) })).json()).toMatchObject({ run: { state: 'completed', messageId: 'message-test' } });
    });
    it('bounds requests and streams and invalidates an established stream after revocation', async () => {
        const f = await fixture();
        const controller = new AbortController();
        const response = await f.app.request('/v1/integration/events', { headers: auth(f.secret), signal: controller.signal });
        const reader = response.body!.getReader();
        expect(new TextDecoder().decode((await reader.read()).value)).toContain('ready');
        f.integrations.revoke(f.token.id);
        let text = '';
        for (let i = 0; i < 4; i++) {
            const part = await reader.read();
            if (part.done)
                break;
            text += new TextDecoder().decode(part.value);
        }
        expect(text === '' || text.includes('heartbeat') || text.includes('auth-expired')).toBe(true);
        await reader.cancel();
        controller.abort();
        const another = f.integrations.create('limits', ['activity:read'], 7);
        const releases = [f.integrations.openStream(another.secret), f.integrations.openStream(another.secret), f.integrations.openStream(another.secret)];
        expect(() => f.integrations.openStream(another.secret)).toThrow('stream_limit');
        releases.forEach(release => release());
        for (let i = 0; i < 120; i++)
            f.integrations.admit(another.secret);
        expect(() => f.integrations.admit(another.secret)).toThrow('rate_limited');
    });
    it('documents every externally mounted operation', () => {
        const docs = integrationOpenApi() as {
            paths: Record<string, Record<string, unknown>>;
        };
        for (const e of INTEGRATION_ENDPOINTS)
            expect(docs.paths[e.path]?.[e.method]).toBeDefined();
    });
});
it('enforces token expiry and a cancel token cannot send or read messages', async () => {
    const f = await fixture(['runs:cancel']);
    expect((await f.app.request('/v1/integration/activity', { headers: auth(f.secret) })).status).toBe(403);
    expect((await f.app.request('/v1/integration/conversations', { method: 'POST', headers: { ...auth(f.secret), 'Idempotency-Key': 'x' } })).status).toBe(403);
    f.clock.advance(7 * 86400000 + 1);
    expect(() => f.integrations.authenticate(f.secret)).toThrow('invalid_integration_token');
});
it('links a queued message to its run without exposing message content', async () => {
    const f = await fixture();
    f.hub.emit({ kind: 'run-started', chatId: 'chat-test', runId: 'run-queued', queuedMessageId: 'queue-123', user: { id: 'message-x', chatId: 'chat-test', role: 'user', content: 'private', thinking: '', tools: [], attachments: [], createdAt: '2026-01-01T00:00:00Z' } });
    const response = await f.app.request('/v1/integration/runs/run-queued', { headers: auth(f.secret) });
    expect(await response.json()).toMatchObject({ run: { queueId: 'queue-123' } });
});


it('does not expose internal pi session paths in conversation listings', async () => {
  const f = await fixture(['conversations:read']);
  f.chats.create();
  const response = await f.app.request('/v1/integration/conversations', {headers:auth(f.secret)});
  const body = await response.text();
  expect(response.status).toBe(200);
  expect(body).not.toContain('piSessionId');
  expect(body).not.toContain('autoTitle');
});
