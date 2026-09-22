// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { filesCache, safeFilesSnapshot, type FilesSnapshot } from './files-cache';

const rows = new Map<string, unknown>();
let quota = false;
class Request {
  result: unknown;
  onsuccess?: () => void;
  onerror?: () => void;
}
class Transaction {
  oncomplete?: () => void;
  onerror?: () => void;
  onabort?: () => void;
  private aborted = false;
  private copy = new Map(rows);
  constructor() {
    setTimeout(() => {
      if (this.aborted) return;
      if (quota) { this.onerror?.(); return; }
      rows.clear(); for (const [key, value] of this.copy) rows.set(key, value);
      this.oncomplete?.();
    }, 0);
  }
  abort() { this.aborted = true; this.onabort?.(); }
  objectStore() {
    return {
      get: (key: string) => {
        const request = new Request();
        queueMicrotask(() => { request.result = structuredClone(this.copy.get(key)); request.onsuccess?.(); });
        return request;
      },
      clear: () => { this.copy.clear(); },
      put: (value: unknown, key: string) => { this.copy.set(key, structuredClone(value)); },
    };
  }
}
const database = { transaction: () => new Transaction(), close: vi.fn() };
function installDatabase() {
  vi.stubGlobal('indexedDB', { open: () => {
    const request = new Request();
    queueMicrotask(() => { request.result = database; request.onsuccess?.(); });
    return request;
  } });
}
const snapshot: FilesSnapshot = { tree: [{ name: 'a.txt', path: 'a.txt', size: 2, mtime: '2026-01-01T00:00:00Z', kind: 'file' }], etag: 'W/"opaque-v1"' };
beforeEach(async () => {
  quota = false; installDatabase(); filesCache.clear(); await filesCache.read('absent');
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('persists only allowlisted metadata and opaque validators, never bodies, links or thumbnails', async () => {
  const dirty = { ...snapshot, token: 'secret', tree: snapshot.tree.map(node => ({ ...node, text: 'secret', body: 'secret', thumbnail: 'data:secret', url: '/signed-secret', children: ['secret'] })) };
  await filesCache.write(dirty as unknown as FilesSnapshot, 'owner');
  expect(await filesCache.read('owner')).toEqual(snapshot);
  expect(JSON.stringify([...rows.values()])).not.toContain('secret');
});
it('isolates login namespaces and bounds total storage to one snapshot', async () => {
  await filesCache.write(snapshot, 'owner-a');
  expect(await filesCache.read('owner-b')).toBeUndefined();
  await filesCache.write({ tree: [] }, 'owner-b');
  expect(rows.size).toBe(1);
  expect(await filesCache.read('owner-a')).toBeUndefined();
});
it('keeps the last-good entry when an oversized snapshot or quota failure arrives', async () => {
  await filesCache.write(snapshot, 'owner');
  const name = 'x'.repeat(4 * 1024 * 1024);
  await filesCache.write({ tree: [{ ...snapshot.tree[0]!, name, path: name }] }, 'owner');
  expect(await filesCache.read('owner')).toEqual(snapshot);
  quota = true; await filesCache.write({ tree: [] }, 'owner'); quota = false;
  expect(await filesCache.read('owner')).toEqual(snapshot);
});
it('rejects corrupted paths, hidden/trash entries, duplicates and obsolete shapes', () => {
  for (const tree of [null, [{}], [{ ...snapshot.tree[0], path: '../a.txt' }], [{ ...snapshot.tree[0], name: '.private', path: '.private' }], [{ ...snapshot.tree[0], name: 'Garbage', path: 'Garbage' }], [snapshot.tree[0], snapshot.tree[0]]]) {
    expect(safeFilesSnapshot({ tree })).toBeUndefined();
  }
  expect(safeFilesSnapshot({ tree: [], etag: '"header\r\ninjection"' })).toEqual({ tree: [] });
});
it('ignores corrupt persistent records without modifying them on read', async () => {
  rows.set('owner', { tree: [{ name: 'bad' }] });
  expect(await filesCache.read('owner')).toBeUndefined();
  expect(rows.has('owner')).toBe(true);
});
it('degrades to online loading when IndexedDB is denied', async () => {
  vi.stubGlobal('indexedDB', { open: () => { throw new DOMException('denied', 'SecurityError'); } });
  expect(await filesCache.read('owner')).toBeUndefined();
  await expect(filesCache.write(snapshot, 'owner')).resolves.toBeUndefined();
  filesCache.clear();
  expect(await filesCache.read('owner')).toBeUndefined();
});
it('times out blocked storage and closes a late open rather than hanging hydration', async () => {
  vi.useFakeTimers();
  const request = new Request();
  vi.stubGlobal('indexedDB', { open: () => request });
  const read = filesCache.read('owner');
  await vi.advanceTimersByTimeAsync(1_501);
  expect(await read).toBeUndefined();
  request.result = database; request.onsuccess?.();
  expect(database.close).toHaveBeenCalled();
});
it('serializes logout cleanup before new-session writes and drops queued old writes', async () => {
  const oldWrite = filesCache.write(snapshot, 'old');
  filesCache.clear();
  const newWrite = filesCache.write({ tree: [] }, 'new');
  await Promise.all([oldWrite, newWrite]);
  expect(await filesCache.read('old')).toBeUndefined();
  expect(await filesCache.read('new')).toEqual({ tree: [] });
});
it('discards an in-flight read when logout occurs', async () => {
  await filesCache.write(snapshot, 'owner');
  const oldRead = filesCache.read('owner');
  filesCache.clear();
  expect(await oldRead).toBeUndefined();
});
