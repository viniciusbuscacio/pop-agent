// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { filesService } from './artifacts';
import { filesCache } from './files-cache';
import { session } from './session';

beforeEach(() => { session.start('owner', true); });
afterEach(() => { session.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('reuses the same metadata tree on 304 without requesting any file content', async () => {
  const previous = { tree: [], etag: '"revision"' };
  const fetch = vi.fn(async () => new Response(null, { status: 304 }));
  vi.stubGlobal('fetch', fetch);
  await expect(filesService.tree(previous)).resolves.toBe(previous);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledWith('/v1/files', expect.any(Object));
});
it('rejects a malformed successful response instead of replacing a valid tree', async () => {
  vi.stubGlobal('fetch', async () => new Response('{"data":{"tree":[]}}'));
  await expect(filesService.tree()).rejects.toThrow('Invalid Files metadata');
});
it('invalidates reads after a settled mutation, including ambiguous failures', async () => {
  const changed = vi.spyOn(filesCache, 'changed');
  vi.stubGlobal('fetch', async () => new Response(null, { status: 204 }));
  await filesService.mkdir('Docs'); expect(changed).toHaveBeenCalledTimes(1);
  vi.stubGlobal('fetch', async () => new Response('{"error":{"code":"failed"}}', { status: 500 }));
  await expect(filesService.move('Docs', 'Other')).rejects.toThrow();
  expect(changed).toHaveBeenCalledTimes(2);
});
it('does not invalidate a new login when an old mutation completes', async () => {
  let finish!: (response: Response) => void;
  vi.stubGlobal('fetch', () => new Promise<Response>(resolve => { finish = resolve; }));
  const changed = vi.spyOn(filesCache, 'changed');
  const write = filesService.mkdir('Docs');
  session.clear(); session.start('owner', true);
  finish(new Response(null, { status: 204 })); await write;
  expect(changed).not.toHaveBeenCalled();
});
