import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync, type FSWatcher } from 'node:fs';
import * as syncDisk from 'node:fs';
import * as disk from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FilesService } from '../../application/files/files-service.js';
import { PersistentFilesIndex } from './persistent-files-index.js';

vi.mock('node:fs', async importOriginal => ({ ...await importOriginal<typeof import('node:fs')>() }));
vi.mock('node:fs/promises', async importOriginal => ({ ...await importOriginal<typeof import('node:fs/promises')>() }));

const cleanup: (() => void)[] = [];
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); vi.useRealTimers(); vi.restoreAllMocks(); });

function fixture(options: { realWatch?: boolean; reconcileMs?: number } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pop-files-index-'));
  const root = join(dir, 'files');
  mkdirSync(root);
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const snapshotPath = join(dir, 'metadata.json');
  const watchers: (EventEmitter & { close: ReturnType<typeof vi.fn>; unref: ReturnType<typeof vi.fn> })[] = [];
  let event: (path: string | null) => void = () => {};
  const onError = vi.fn();
  const create = () => {
    const index = new PersistentFilesIndex({
      root, snapshotPath, onError, batchMs: 10, retryMs: 100,
      ...(options.reconcileMs ? { reconcileMs: options.reconcileMs } : {}),
      ...(!options.realWatch ? { watch: (_root: string, listener: (path: string | null) => void) => {
        event = listener;
        const watcher = Object.assign(new EventEmitter(), { close: vi.fn(), unref: vi.fn() });
        watchers.push(watcher);
        return watcher as unknown as FSWatcher;
      } } : {}),
    });
    cleanup.push(() => index.close());
    return index;
  };
  const index = create();
  const files = new FilesService({ root, clock: { now: () => Date.now() }, index });
  return { root, dir, snapshotPath, index, files, create, onError, watchers, event: (path: string | null) => event(path) };
}

describe('persistent Files metadata', () => {
  it('bootstraps, batches an owner-only snapshot outside Files and warm-loads without reading bodies', async () => {
    vi.useFakeTimers();
    const f = fixture();
    writeFileSync(join(f.root, 'hello.txt'), 'content');
    expect(f.index.available()).toBe(false);
    await f.index.start();
    expect(f.index.tree()).toMatchObject([{ path: 'hello.txt', size: 7 }]);
    await vi.advanceTimersByTimeAsync(10);
    expect(statSync(f.snapshotPath).mode & 0o777).toBe(0o600);
    expect(readFileSync(f.snapshotPath, 'utf8')).not.toContain('content');
    f.index.close();
    const warm = f.create();
    expect(warm.available()).toBe(true);
    expect(warm.tree()).toEqual(f.index.tree());
    expect(() => new PersistentFilesIndex({ root: f.root, snapshotPath: join(f.root, 'cache.json') })).toThrow('outside Files');
  });

  it('keeps the previous atomic snapshot on persistence failure and retries the latest batch', async () => {
    vi.useFakeTimers();
    const f = fixture();
    await f.index.start();
    await vi.advanceTimersByTimeAsync(10);
    const old = readFileSync(f.snapshotPath, 'utf8');
    f.files.write('one.txt', Buffer.from('one'));
    f.files.write('two.txt', Buffer.from('two'));
    expect(readFileSync(f.snapshotPath, 'utf8')).toBe(old);
    vi.spyOn(syncDisk, 'renameSync').mockImplementationOnce(() => { throw new Error('private failure'); });
    await vi.advanceTimersByTimeAsync(10);
    expect(readFileSync(f.snapshotPath, 'utf8')).toBe(old);
    expect(f.index.available()).toBe(true);
    expect(f.onError).toHaveBeenCalledWith('files_index_persist_failed');
    await vi.advanceTimersByTimeAsync(100);
    expect(readFileSync(f.snapshotPath, 'utf8')).toContain('two.txt');
    expect(syncDisk.readdirSync(f.dir).filter(name => name.endsWith('.pending'))).toEqual([]);
  });

  it('recovers failed scans without publishing a partial empty replacement', async () => {
    vi.useFakeTimers();
    const f = fixture();
    await f.index.start();
    f.files.write('old.txt', Buffer.from('old'));
    renameSync(f.root, join(f.dir, 'old-root'));
    await f.index.reconcile();
    expect(f.index.available()).toBe(false);
    expect(f.index.tree()[0]?.path).toBe('old.txt');
    mkdirSync(f.root);
    writeFileSync(join(f.root, 'recovered.txt'), 'recovered');
    await vi.advanceTimersByTimeAsync(100);
    await f.index.reconcile();
    expect(f.index.available()).toBe(true);
    expect(f.index.tree().map(node => node.path)).toEqual(['recovered.txt']);
  });

  it('repairs restart gaps and corrupt snapshots in background rather than on reads', async () => {
    const f = fixture();
    await f.index.start();
    f.files.write('before.txt', Buffer.from('old'));
    f.index.close();
    rmSync(join(f.root, 'before.txt'));
    writeFileSync(join(f.root, 'after.txt'), 'new');
    const warm = f.create();
    expect(warm.tree()[0]?.path).toBe('before.txt');
    await warm.start();
    expect(warm.tree().map(node => node.path)).toEqual(['after.txt']);
    warm.close();
    writeFileSync(f.snapshotPath, '{bad json');
    const cold = f.create();
    expect(cold.available()).toBe(false);
    await cold.start();
    expect(cold.tree().map(node => node.path)).toEqual(['after.txt']);
  });

  it('updates write/edit/mkdir/move/trash/restore immediately, without full reconciliation', async () => {
    const f = fixture();
    await f.index.start();
    const scan = vi.spyOn(f.index, 'reconcile');
    const changed = vi.fn();
    f.index.subscribe(changed);
    f.files.write('a/deep/note.txt', Buffer.from('abc'));
    expect(f.index.tree()[0]?.children?.[0]?.children?.[0]?.size).toBe(3);
    const text = f.files.readText('a/deep/note.txt');
    if (typeof text === 'string') throw new Error(text);
    f.files.saveText('a/deep/note.txt', 'longer', text.revision);
    f.files.mkdir('empty');
    expect(f.files.move('a', 'b')).toBe('ok');
    expect(f.index.tree().map(node => node.path)).toEqual(['b', 'empty']);
    expect(f.index.tree()[0]?.children?.[0]?.children?.[0]).toMatchObject({ path: 'b/deep/note.txt', size: 6 });
    const removed = f.files.remove('b');
    if (removed === 'not-found') throw new Error('missing');
    expect(f.index.tree().map(node => node.path)).toEqual(['empty']);
    f.files.restore(removed.name);
    expect(f.index.tree().map(node => node.path)).toEqual(['b', 'empty']);
    expect(scan).not.toHaveBeenCalled();
    expect(changed).toHaveBeenCalledTimes(6);
  });

  it('observes recursive external disk changes and directory renames', async () => {
    const f = fixture({ realWatch: true });
    await f.index.start();
    mkdirSync(join(f.root, 'external', 'nested'), { recursive: true });
    writeFileSync(join(f.root, 'external', 'nested', 'file.txt'), 'agent');
    await vi.waitFor(() => expect(f.index.tree()[0]?.children?.[0]?.children?.[0]?.size).toBe(5));
    renameSync(join(f.root, 'external'), join(f.root, 'renamed'));
    await vi.waitFor(() => expect(f.index.tree().map(node => node.path)).toEqual(['renamed']));
    rmSync(join(f.root, 'renamed'), { recursive: true });
    await vi.waitFor(() => expect(f.index.tree()).toEqual([]));
  });

  it('reconciles daily missed events, with no disk work initiated by tree reads', async () => {
    vi.useFakeTimers();
    const f = fixture({ reconcileMs: 1_000 });
    await f.index.start();
    const scan = vi.spyOn(f.index, 'reconcile');
    writeFileSync(join(f.root, 'missed.txt'), 'missed');
    for (let i = 0; i < 10; i++) expect(f.index.tree()).toEqual([]);
    expect(scan).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(scan).toHaveBeenCalledTimes(1);
    await f.index.reconcile();
    expect(f.index.tree()[0]?.path).toBe('missed.txt');
  });

  it('replays mutations received while a full scan is awaiting I/O', async () => {
    const f = fixture();
    f.files.write('old.txt', Buffer.from('old'));
    await f.index.start();
    const original = disk.lstat;
    let captured!: () => void;
    let release!: () => void;
    const atOldMetadata = new Promise<void>(resolve => { captured = resolve; });
    const continueScan = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(disk, 'lstat').mockImplementationOnce((async (path) => {
      const stat = await original(path);
      captured();
      await continueScan;
      return stat;
    }) as typeof disk.lstat);
    const scanning = f.index.reconcile();
    await atOldMetadata;
    f.files.move('old.txt', 'new/deep.txt');
    f.files.write('new/deep.txt', Buffer.from('latest value'));
    release();
    await scanning;
    expect(f.index.tree().map(node => node.path)).toEqual(['new']);
    expect(f.index.tree()[0]?.children?.[0]).toMatchObject({ path: 'new/deep.txt', size: 12 });
  });

  it('fails unavailable and retries watcher errors and unknown-filename gaps', async () => {
    vi.useFakeTimers();
    const f = fixture();
    await f.index.start();
    f.watchers[0]?.emit('error', new Error('private path must not be logged'));
    expect(f.index.available()).toBe(false);
    expect(f.onError).toHaveBeenCalledWith('files_index_watch_failed');
    writeFileSync(join(f.root, 'gap.txt'), 'gap');
    await vi.advanceTimersByTimeAsync(100);
    await f.index.reconcile();
    expect(f.watchers).toHaveLength(2);
    expect(f.index.available()).toBe(true);
    expect(f.index.tree()[0]?.path).toBe('gap.txt');
    f.event(null);
    expect(f.index.available()).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    await f.index.reconcile();
    expect(f.index.available()).toBe(true);
  });

  it('excludes hidden/trash paths, every symlink, unsafe snapshot paths and symlinked ancestors', async () => {
    const f = fixture();
    mkdirSync(join(f.dir, 'outside'));
    writeFileSync(join(f.dir, 'outside', 'secret.txt'), 'secret');
    mkdirSync(join(f.root, '.private'));
    writeFileSync(join(f.root, '.private', 'hidden.txt'), 'hidden');
    writeFileSync(join(f.root, 'Garbage', 'deleted.txt'), 'trash');
    symlinkSync(join(f.dir, 'outside'), join(f.root, 'escape'));
    writeFileSync(join(f.root, 'visible.txt'), 'visible');
    symlinkSync(join(f.root, 'visible.txt'), join(f.root, 'alias.txt'));
    await f.index.start();
    expect(f.index.tree().map(node => node.path)).toEqual(['visible.txt']);
    f.files.write('replaced/note.txt', Buffer.from('safe'));
    rmSync(join(f.root, 'replaced'), { recursive: true });
    symlinkSync(join(f.dir, 'outside'), join(f.root, 'replaced'));
    f.index.changed(['replaced/secret.txt', '../outside/secret.txt', 'Garbage/deleted.txt', '.private/hidden.txt']);
    expect(f.index.tree().map(node => node.path)).toEqual(['visible.txt']);
    f.index.close();
    writeFileSync(f.snapshotPath, JSON.stringify({ version: 1, root: f.root, tree: [{ name: '../secret', path: '../secret', kind: 'file', size: 1, mtimeMs: 1 }] }));
    expect(f.create().available()).toBe(false);
  });
});
