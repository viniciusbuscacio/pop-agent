import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { FilesService } from '../../application/files/files-service.js';
import { PersistentFilesIndex } from '../../infrastructure/files/persistent-files-index.js';
import { createFilesRoutes } from './files-routes.js';
import { SseHub } from './sse-hub.js';

const cleanup: (() => void)[] = [];
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); });

it('serves precomputed metadata, reports bootstrap unavailable and invalidates external changes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pop-files-http-'));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const root = join(dir, 'files');
  mkdirSync(root);
  const index = new PersistentFilesIndex({ root, snapshotPath: join(dir, 'cache.json'), batchMs: 5 });
  cleanup.push(() => index.close());
  const clock = { now: () => Date.now() };
  const files = new FilesService({ root, clock, index });
  const hub = new SseHub();
  files.subscribeTree(() => hub.invalidate(['files']));
  const routes = createFilesRoutes({ files, clock, secretKey: Buffer.alloc(32) });
  const unavailable = await routes.request('/files', { headers: { 'If-None-Match': '*' } });
  expect(unavailable.status).toBe(503);
  expect(unavailable.headers.get('cache-control')).toBe('no-store');
  expect(await unavailable.json()).toMatchObject({ error: { code: 'files_index_unavailable' } });
  await index.start();
  const tree = vi.spyOn(files, 'tree');
  const first = await routes.request('/files');
  const etag = first.headers.get('etag')!;
  expect(first.status).toBe(200);
  expect(await first.json()).toEqual({ tree: [] });
  for (let i = 0; i < 3; i++) {
    expect((await routes.request('/files', { headers: { 'If-None-Match': etag } })).status).toBe(304);
  }
  expect(tree).not.toHaveBeenCalled();
  const revision = hub.manifest().revisions['files']!;
  writeFileSync(join(root, 'agent.txt'), 'agent-created bytes');
  await vi.waitFor(() => expect(hub.manifest().revisions['files']).toBeGreaterThan(revision));
  const changed = await routes.request('/files', { headers: { 'If-None-Match': etag } });
  expect(changed.status).toBe(200);
  expect(changed.headers.get('etag')).not.toBe(etag);
  expect(await changed.json()).toMatchObject({ tree: [{ path: 'agent.txt', kind: 'file', size: 19 }] });
  expect(tree).toHaveBeenCalledTimes(1);
});
