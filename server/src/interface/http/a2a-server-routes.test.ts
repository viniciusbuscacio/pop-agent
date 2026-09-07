import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, setupTestSession } from '../../testing/app-fixture.js';
import { SdkA2aClientFactory } from '../../infrastructure/a2a/sdk-a2a-client.js';
import { A2aInboundService } from '../../application/a2a/a2a-inbound-service.js';
import { A2aSettingsService } from '../../application/a2a/a2a-settings.js';
import type { A2aAgent } from '../../application/ports/a2a-repo.js';
import * as sourceIp from './rest-client-ip.js';
afterEach(() => vi.restoreAllMocks());
const origin = 'https://peer.example';
const auth = (secret: string) => ({ authorization: 'Bearer ' + secret, 'content-type': 'application/json' });
function fixture() {
  const f = createTestApp();
  const key = f.a2aSettings.ensureKey();
  f.a2aSettings.configure({ serverEnabled: true });
  vi.spyOn(sourceIp, 'restClientIp').mockReturnValue('127.0.0.1');
  const agent = {
    id: 'peer', name: 'Peer', baseUrl: origin, agentCardPath: '.well-known/agent-card.json',
    authKind: 'bearer', enabled: true, timeoutMs: 5000,
  } as A2aAgent;
  const client = new SdkA2aClientFactory({ fetchDeps: {
    resolve: async () => ['8.8.8.8'],
    retrieve: async request => f.app.request(request),
  } }).create(agent, key);
  const rpc = (method: string, params: Record<string, unknown>, secret = key) =>
    f.app.request(origin + '/a2a/rpc', { method: 'POST', headers: auth(secret),
      body: JSON.stringify({ jsonrpc: '2.0', id: 'request', method, params }) });
  return { ...f, key, client, rpc };
}
describe('inbound A2A', () => {
  it('interoperates with the official client, creates a labeled chat and retains results', async () => {
    const f = fixture();
    const card = await f.client.discover();
    expect(card.protocolVersion).toBe('1.0');
    const result = await f.client.sendText('A2A hello');
    expect(result.state).toBe('completed');
    expect(result.responseText).toContain('staged reply');
    const incoming = f.chats.list({ archived: false })[0]!;
    expect(f.chats.getMessages(incoming.id, { limit: 10 })?.find(message => message.role === 'user')?.content).toBe('A2A hello');
    expect(f.chats.list({ archived: false })[0]?.title).toMatch(/^A2A/);
    expect((await f.client.getTask(result.remoteTaskId)).state).toBe('completed');
    const restored = new A2aInboundService({ repo: f.a2aInboundRepo, clock: f.clock, chats: f.chats, runs: f.runs, integrations: f.integrations });
    expect(restored.get(result.remoteTaskId).text).toBe(result.responseText);
  });
  it('deduplicates identical message IDs and refuses changed retries or owner chat IDs', async () => {
    const f = fixture();
    const input = { messageId: 'same', contextId: '', taskId: '', text: 'hello' };
    const first = f.a2aInbound.send(input);
    expect(f.a2aInbound.send(input).id).toBe(first.id);
    expect(() => f.a2aInbound.send({ ...input, text: 'changed' })).toThrow('different content');
    const ownerChat = f.chats.create();
    expect(() => f.a2aInbound.send({ ...input, messageId: 'next', contextId: ownerChat.id })).toThrow('No such A2A context');
    expect(() => f.a2aInbound.get(ownerChat.id)).toThrow('No such A2A task');
    await f.a2aInbound.wait(first.id, new AbortController().signal, () => undefined);
  });
  it('keeps switches and keys separate and denies disallowed source IPs', async () => {
    const f = fixture();
    const fresh = new A2aSettingsService({ get: () => undefined, set: () => undefined }, f.secrets);
    expect(fresh.get()).toEqual({ serverEnabled: false, clientEnabled: false });
    const owner = await setupTestSession(f.app);
    expect((await f.app.request(origin + '/.well-known/agent-card.json', { headers: auth(owner) })).status).toBe(401);
    const restKey = f.integrations.ensureAccessKey();
    expect((await f.app.request(origin + '/.well-known/agent-card.json', { headers: auth(restKey) })).status).toBe(401);
    const replacement = f.a2aSettings.rotateKey();
    expect((await f.app.request(origin + '/.well-known/agent-card.json', { headers: auth(f.key) })).status).toBe(401);
    expect((await f.app.request(origin + '/.well-known/agent-card.json', { headers: auth(replacement) })).status).toBe(200);
    vi.mocked(sourceIp.restClientIp).mockReturnValue('100.70.1.2');
    expect((await f.app.request(origin + '/.well-known/agent-card.json', { headers: auth(replacement) })).status).toBe(403);
    f.a2aSettings.setAllowedIps(['100.70.1.2/32']);
    expect((await f.app.request(origin + '/.well-known/agent-card.json', { headers: auth(replacement) })).status).toBe(200);
    f.a2aSettings.configure({ serverEnabled: false, clientEnabled: true });
    expect((await f.app.request(origin + '/.well-known/agent-card.json', { headers: auth(replacement) })).status).toBe(503);
    expect(f.a2aSettings.get().clientEnabled).toBe(true);
  });
  it('cancels only the referenced A2A task and retains honest status', async () => {
    const f = fixture();
    const task = f.a2aInbound.send({ messageId: 'slow', contextId: '', taskId: '', text: 'slow: cancel this' });
    f.a2aInbound.cancel(task.id);
    const ended = await f.a2aInbound.wait(task.id, new AbortController().signal, () => undefined);
    expect(ended.state).toBe('canceled');
    expect(() => f.a2aInbound.cancel(task.id)).toThrow('already finished');
  });
  it('requires owner authentication for configuration and rejects oversized protocol bodies', async () => {
    const f = fixture();
    for (const path of ['/v1/a2a/settings', '/v1/a2a/server/key', '/v1/a2a/server/allowed-ips', '/v1/a2a/client/allowed-ips'])
      expect((await f.app.request(path, { headers: auth(f.key) })).status).toBe(401);
    expect((await f.app.request(origin + '/a2a/rpc', { method: 'POST', headers: auth(f.key), body: 'x'.repeat(129 * 1024) })).status).toBe(413);
  });
});

it.each(['owner', 'agent'] as const)('retains reported %s authorship in the incoming chat DTO', async author => {
  const f = fixture();
  const result = await f.client.sendText('origin test', undefined, author);
  expect(result.state).toBe('completed');
  const owner = await setupTestSession(f.app);
  const chat = f.chats.list({ archived: false })[0]!;
  const response = await f.app.request('/v1/chats/' + chat.id + '/messages', { headers: auth(owner) });
  expect(response.status).toBe(200);
  const body = await response.json() as { messages: { role: string; a2aAuthor?: string }[] };
  expect(body.messages.find(message => message.role === 'user')?.a2aAuthor).toBe(author);
});
it('stops a blocking wait when the key is replaced without claiming cancellation', async () => {
  const f = fixture();
  const controller = new AbortController();
  // Force a live state long enough to exercise revocation independently of model speed.
  const get = vi.spyOn(f.a2aInbound, 'get').mockReturnValue({ id: 'wait', contextId: 'context', state: 'working', text: '', timestamp: new Date().toISOString() });
  const pending = f.a2aInbound.wait('wait', controller.signal, () => f.a2aSettings.authorize(f.key, '127.0.0.1'));
  f.a2aSettings.rotateKey();
  await expect(pending).rejects.toMatchObject({ code: 'invalid_a2a_key' });
  get.mockRestore();
});
it('deduplicates a task after service reconstruction and keeps the answer after activity pruning', async () => {
  const f = fixture();
  const input = { messageId: 'persist', contextId: '', taskId: '', text: 'keep this' };
  const task = f.a2aInbound.send(input);
  const ended = await f.a2aInbound.wait(task.id, new AbortController().signal, () => undefined);
  f.integrations.repo.prune(Date.now() + 365 * 86400000);
  const restored = new A2aInboundService({ repo: f.a2aInboundRepo, clock: f.clock, chats: f.chats, runs: f.runs, integrations: f.integrations });
  expect(restored.send(input)).toEqual(ended);
  expect(f.chats.list({ archived: false })).toHaveLength(1);
});
