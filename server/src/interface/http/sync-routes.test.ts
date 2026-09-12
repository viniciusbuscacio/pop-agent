import { describe, expect, it } from 'vitest';
import { SseHub } from './sse-hub.js';
import { changedSettingsResources, createSyncRoutes } from './sync-routes.js';
import { createTestApp, setupTestSession } from '../../testing/app-fixture.js';

describe('synchronization manifest', () => {
  it('rejects anonymous access through the real route registry', async () => {
    const { app } = createTestApp();
    const token = await setupTestSession(app, 'correct-horse-battery-staple');
    expect((await app.request('/v1/sync')).status).toBe(401);
    const response = await app.request('/v1/sync', { headers: { Authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
  });
  it('returns independent, no-store process revisions without resource contents', async () => {
    const hub = new SseHub(); const initial = hub.manifest();
    hub.invalidate(['settings', 'memory']);
    const response = await createSyncRoutes(hub).request('/sync');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({ epoch: initial.epoch, revisions: { settings: 1, memory: 1 } });
    expect(initial.revisions).toEqual({}); expect(new SseHub().manifest().epoch).not.toBe(initial.epoch);
  });
  it('withholds resource invalidations from old bundles and advances revisions before delivery', () => {
    const hub = new SseHub(); const old: string[] = []; const current: string[] = [];
    hub.subscribe(value => old.push(value), 2);
    hub.subscribe(value => { expect(hub.manifest().revisions.memory).toBe(1); current.push(value); }, 3);
    hub.invalidate(['memory']);
    expect(old).toEqual([]); expect(current.map(value => JSON.parse(value) as unknown)).toEqual([{ kind: 'resources-changed', keys: ['memory'] }]);
  });
  it('tracks chat activity without extra invalidation frames and removes deleted keys', () => {
    const hub = new SseHub(); hub.emit({ kind: 'delta', chatId: 'c', runId: 'r', seq: 1, text: 'private' });
    expect(hub.manifest().revisions['chat:c']).toBe(1);
    expect(JSON.stringify(hub.manifest())).not.toContain('private');
    hub.emit({ kind: 'chat-deleted', chatId: 'c' }); expect(hub.manifest().revisions['chat:c']).toBeUndefined();
    expect(hub.manifest().revisions.chats).toBe(2);
  });
  it('maps mutations, never GET reads, to display resources', () => {
    expect(changedSettingsResources('GET', '/v1/providers')).toEqual([]);
    expect(changedSettingsResources('PATCH', '/v1/settings')).toEqual(['settings']);
    expect(changedSettingsResources('PUT', '/v1/memory')).toEqual(['memory']);
    expect(changedSettingsResources('POST', '/v1/events/ticket')).toEqual([]);
  });
});
