// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest';
import { useFilesStore } from './files';
import { filesCache, type FilesSnapshot } from '../services/files-cache';
import { filesService } from '../services/artifacts';
import { session } from '../services/session';

vi.mock('../services/artifacts', () => ({ filesService: { tree: vi.fn() } }));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const old: FilesSnapshot = { tree: [{ name: 'old', path: 'old', kind: 'file', size: 1, mtime: '2026-01-01T00:00:00Z' }], etag: '"old"' };
const next: FilesSnapshot = { tree: [], etag: '"next"' };
beforeEach(() => {
  vi.restoreAllMocks();
  session.start('owner', true);
  vi.spyOn(filesCache, 'read').mockResolvedValue(undefined);
  vi.spyOn(filesCache, 'write').mockResolvedValue();
  vi.mocked(filesService.tree).mockReset().mockResolvedValue(next);
});
it('hydrates before conditional revalidation, deduplicating simultaneous page/sidebar reads', async () => {
  const cache = deferred<FilesSnapshot>(); const network = deferred<FilesSnapshot>();
  vi.mocked(filesCache.read).mockReturnValue(cache.promise);
  vi.mocked(filesService.tree).mockReturnValue(network.promise);
  const first = useFilesStore.getState().reload();
  expect(useFilesStore.getState().reload()).toBe(first);
  expect(useFilesStore.getState().tree).toBeUndefined();
  expect(filesService.tree).not.toHaveBeenCalled();
  cache.resolve(old); await Promise.resolve(); await Promise.resolve();
  expect(useFilesStore.getState().tree).toBe(old.tree);
  expect(filesService.tree).toHaveBeenCalledExactlyOnceWith(old);
  network.resolve(next); await first;
  expect(useFilesStore.getState()).toMatchObject({ tree: [], error: false, fresh: true, loading: false });
});
it('shows RAM immediately without rereading disk and retains it on failure', async () => {
  await useFilesStore.getState().reload();
  vi.mocked(filesCache.read).mockClear();
  vi.mocked(filesService.tree).mockRejectedValue(new Error('offline'));
  const request = useFilesStore.getState().reload();
  expect(useFilesStore.getState().tree).toBe(next.tree);
  await request;
  expect(filesCache.read).not.toHaveBeenCalled();
  expect(useFilesStore.getState()).toMatchObject({ tree: [], error: true, fresh: false, loading: false });
});
it('reports first-load failure without painting false empty and permits retry', async () => {
  vi.mocked(filesService.tree).mockRejectedValueOnce(new Error('offline'));
  await useFilesStore.getState().reload();
  expect(useFilesStore.getState()).toMatchObject({ tree: undefined, error: true, loading: false });
  await useFilesStore.getState().reload();
  expect(useFilesStore.getState()).toMatchObject({ tree: [], error: false, fresh: true });
});
it('mutation refresh never joins a pre-mutation request or accepts its late response', async () => {
  const stale = deferred<FilesSnapshot>();
  vi.mocked(filesService.tree).mockReturnValueOnce(stale.promise);
  const first = useFilesStore.getState().reload();
  await Promise.resolve(); await Promise.resolve();
  filesCache.changed();
  const second = useFilesStore.getState().reload();
  expect(second).not.toBe(first);
  await second;
  stale.resolve(old); await first;
  expect(filesService.tree).toHaveBeenCalledTimes(2);
  expect(useFilesStore.getState().tree).toBe(next.tree);
  expect(filesCache.write).toHaveBeenCalledTimes(1);
});
it('invalidates a late disk hydration after mutation', async () => {
  const cache = deferred<FilesSnapshot>();
  vi.mocked(filesCache.read).mockReturnValue(cache.promise);
  const hydrate = useFilesStore.getState().hydrate();
  filesCache.changed(); await useFilesStore.getState().reload();
  cache.resolve(old); await hydrate;
  expect(useFilesStore.getState().tree).toBe(next.tree);
});
it('rejects old-session network results even when login reuses the token', async () => {
  const stale = deferred<FilesSnapshot>();
  vi.mocked(filesService.tree).mockReturnValueOnce(stale.promise);
  const first = useFilesStore.getState().reload();
  await Promise.resolve(); await Promise.resolve();
  session.clear(); session.start('owner', true);
  await useFilesStore.getState().reload();
  stale.resolve(old); await first;
  expect(useFilesStore.getState().tree).toBe(next.tree);
  expect(filesCache.write).toHaveBeenCalledTimes(1);
});
it('logout discards pending hydration and never starts its authenticated read', async () => {
  const cache = deferred<FilesSnapshot>();
  vi.mocked(filesCache.read).mockReturnValue(cache.promise);
  const first = useFilesStore.getState().reload(); session.clear();
  cache.resolve(old); await first;
  expect(useFilesStore.getState()).toMatchObject({ tree: undefined, loading: false, error: false });
  expect(filesService.tree).not.toHaveBeenCalled();
  expect(filesCache.write).not.toHaveBeenCalled();
  await useFilesStore.getState().reload();
  expect(filesService.tree).not.toHaveBeenCalled();
});
