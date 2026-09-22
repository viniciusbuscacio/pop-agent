import { randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { FileNode } from '../../application/files/files-service.js';
import type { FilesIndex } from '../../application/ports/files-index.js';

const DAY = 24 * 60 * 60 * 1000;
type Entry = Omit<FileNode, 'children'>;
type Watcher = Pick<FSWatcher, 'close' | 'on' | 'unref'>;
interface Options {
  root: string;
  snapshotPath: string;
  onError?: (code: string) => void;
  watch?: (root: string, listener: (path: string | null) => void) => Watcher;
  reconcileMs?: number;
  retryMs?: number;
  batchMs?: number;
}

/** Disposable, metadata-only projection. No request ever initiates disk work. */
export class PersistentFilesIndex implements FilesIndex {
  private readonly root: string;
  private entries = new Map<string, Entry>();
  private nodes: FileNode[] = [];
  private serialized = '[]';
  private ready = false;
  private closed = false;
  private started = false;
  private dirty = false;
  private watcher: Watcher | undefined;
  private daily: ReturnType<typeof setInterval> | undefined;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private batch: ReturnType<typeof setTimeout> | undefined;
  private persistTimer: ReturnType<typeof setTimeout> | undefined;
  private scanning: Promise<void> | undefined;
  private journal = new Set<string>();
  private pending = new Set<string>();
  private readonly listeners = new Set<() => void>();

  constructor(private readonly options: Options) {
    this.root = realpathSync(options.root);
    const snapshot = resolve(options.snapshotPath);
    // Check the existing parent too: a lexical sibling can point back into Files.
    mkdirSync(dirname(snapshot), { recursive: true, mode: 0o700 });
    const parent = realpathSync(dirname(snapshot));
    if (parent === this.root || parent.startsWith(this.root + sep)) {
      throw new Error('Files metadata must be stored outside Files.');
    }
    this.load();
  }

  tree(): FileNode[] { return this.nodes; }
  available(): boolean { return this.ready; }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  async start(): Promise<void> {
    if (this.started || this.closed) return;
    this.started = true;
    this.openWatcher();
    // Always reconcile the downtime gap, even with a valid warm snapshot.
    await this.reconcile();
    if (!this.closed) this.daily = setInterval(() => { void this.reconcile(); }, this.options.reconcileMs ?? DAY).unref();
  }

  /** Synchronous Pop mutations are visible before their HTTP response. */
  changed(paths: string[]): void {
    if (this.closed) return;
    const visible = paths.filter(visiblePath);
    for (const path of visible) if (this.scanning) this.journal.add(path);
    try {
      for (const path of visible) this.refresh(this.entries, path);
      this.publish();
    } catch { this.recover('files_index_incremental_failed'); }
  }

  /** Startup, daily maintenance and recovery only, never called by reads. */
  reconcile(): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.scanning) return this.scanning;
    this.journal.clear();
    this.scanning = this.scan().then((next) => {
      if (this.closed) return;
      // Replay against live disk without yielding: an old scan cannot overwrite
      // Pop mutations or watcher notifications received during its awaits.
      for (const path of this.journal) this.refresh(next, path);
      this.entries = next;
      const wasReady = this.ready;
      this.ready = this.watcher !== undefined;
      this.publish(wasReady !== this.ready);
    }).catch(() => { this.recover('files_index_scan_failed'); }).finally(() => {
      this.scanning = undefined;
      this.journal.clear();
    });
    return this.scanning;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.watcher?.close();
    this.watcher = undefined;
    clearInterval(this.daily);
    clearTimeout(this.retry);
    clearTimeout(this.batch);
    clearTimeout(this.persistTimer);
    // Pending watcher events are applied before the final atomic snapshot.
    if (this.pending.size) {
      try { for (const path of this.pending) this.refresh(this.entries, path); this.publish(); }
      catch { this.options.onError?.('files_index_close_failed'); }
    }
    this.persist();
    this.listeners.clear();
  }

  private openWatcher(): void {
    if (this.closed || this.watcher) return;
    try {
      const listener = (path: string | null): void => {
        if (this.closed) return;
        if (path === null || path === '') { this.recover('files_index_watch_path_missing'); return; }
        const normalized = path.split(sep).join('/');
        if (!visiblePath(normalized)) return;
        if (this.scanning) this.journal.add(normalized);
        this.pending.add(normalized);
        this.batch ??= setTimeout(() => {
          this.batch = undefined;
          const paths = [...this.pending];
          this.pending.clear();
          this.changed(paths);
        }, this.options.batchMs ?? 50).unref();
      };
      this.watcher = this.options.watch
        ? this.options.watch(this.root, listener)
        : watch(this.root, { recursive: true }, (_event, filename) => listener(filename));
      const watcher = this.watcher;
      watcher.on('error', () => { if (this.watcher === watcher) this.recover('files_index_watch_failed'); });
      watcher.on('close', () => { if (this.watcher === watcher) this.recover('files_index_watch_closed'); });
      watcher.unref();
    } catch { this.recover('files_index_watch_failed'); }
  }

  private recover(code: string): void {
    if (this.closed) return;
    this.options.onError?.(code);
    const watcher = this.watcher;
    this.watcher = undefined;
    watcher?.close();
    if (this.ready) { this.ready = false; this.notify(); }
    this.retry ??= setTimeout(() => {
      this.retry = undefined;
      this.openWatcher();
      void this.reconcile();
    }, this.options.retryMs ?? 5_000).unref();
  }

  private safe(path: string): boolean {
    if (!visiblePath(path)) return false;
    if (lstatSync(this.root).isSymbolicLink() || realpathSync(this.root) !== this.root) throw new Error('Files root changed');
    let current = this.root;
    for (const part of path.split('/')) {
      current = join(current, part);
      try { if (lstatSync(current).isSymbolicLink()) return false; }
      catch (error) { if (missing(error)) return false; throw error; }
    }
    return true;
  }

  private entry(path: string): Entry | undefined {
    if (!this.safe(path)) return undefined;
    try {
      const stat = lstatSync(join(this.root, path));
      if ((!stat.isFile() && !stat.isDirectory()) || !this.safe(path)) return undefined;
      return { path, name: path.split('/').at(-1)!, kind: stat.isDirectory() ? 'dir' : 'file', size: stat.isDirectory() ? 0 : stat.size, mtimeMs: stat.mtimeMs };
    } catch (error) { if (missing(error)) return undefined; throw error; }
  }

  private refresh(target: Map<string, Entry>, path: string): void {
    // Refresh ancestor metadata without walking unrelated siblings. Missing or
    // symlinked ancestors invalidate the entire formerly visible subtree.
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) {
      const parent = parts.slice(0, i).join('/');
      const entry = this.entry(parent);
      if (!entry || entry.kind !== 'dir') { this.drop(target, parent); if (entry) target.set(parent, entry); return; }
      target.set(parent, entry);
    }
    this.drop(target, path);
    const visit = (relative: string): void => {
      const entry = this.entry(relative);
      if (!entry) return;
      target.set(relative, entry);
      if (entry.kind !== 'dir') return;
      try {
        for (const name of readdirSync(join(this.root, relative))) {
          const child = `${relative}/${name}`;
          if (visiblePath(child)) visit(child);
        }
      } catch (error) { if (!missing(error)) throw error; }
      if (!this.safe(relative)) this.drop(target, relative);
    };
    visit(path);
  }

  private drop(target: Map<string, Entry>, path: string): void {
    for (const key of target.keys()) if (key === path || key.startsWith(path + '/')) target.delete(key);
  }

  private async scan(): Promise<Map<string, Entry>> {
    if (lstatSync(this.root).isSymbolicLink() || realpathSync(this.root) !== this.root) throw new Error('Files root changed');
    const next = new Map<string, Entry>();
    const visit = async (relative: string): Promise<void> => {
      if (this.closed) return;
      if (relative && !this.safe(relative)) return;
      let names: string[];
      try { names = await readdir(join(this.root, relative)); }
      catch (error) { if (relative && missing(error)) return; throw error; }
      for (const name of names) {
        const path = relative ? `${relative}/${name}` : name;
        if (!visiblePath(path) || !this.safe(path)) continue;
        try {
          const stat = await lstat(join(this.root, path));
          if (!stat.isFile() && !stat.isDirectory()) continue;
          if (!this.safe(path)) continue;
          next.set(path, { path, name, kind: stat.isDirectory() ? 'dir' : 'file', size: stat.isDirectory() ? 0 : stat.size, mtimeMs: stat.mtimeMs });
          if (stat.isDirectory()) await visit(path);
        } catch (error) { if (!missing(error)) throw error; }
      }
      if (relative && !this.safe(relative)) this.drop(next, relative);
    };
    await visit('');
    return next;
  }

  private publish(force = false): void {
    const nodes: FileNode[] = [];
    const directories = new Map<string, FileNode[]>();
    directories.set('', nodes);
    for (const entry of [...this.entries.values()].sort((a, b) => a.path.split('/').length - b.path.split('/').length || (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1))) {
      const node: FileNode = { ...entry, ...(entry.kind === 'dir' ? { children: [] } : {}) };
      const parent = directories.get(entry.path.includes('/') ? entry.path.slice(0, entry.path.lastIndexOf('/')) : '');
      if (!parent) continue;
      parent.push(node);
      if (node.children) directories.set(node.path, node.children);
    }
    const serialized = JSON.stringify(nodes);
    if (serialized === this.serialized && !force) return;
    this.nodes = nodes;
    this.serialized = serialized;
    this.dirty = true;
    this.notify();
    if (!this.closed) this.persistTimer ??= setTimeout(() => { this.persistTimer = undefined; this.persist(); }, this.options.batchMs ?? 50).unref();
  }

  private notify(): void { for (const listener of this.listeners) listener(); }

  private load(): void {
    try {
      if (!lstatSync(this.options.snapshotPath).isFile()) return;
      const raw: unknown = JSON.parse(readFileSync(this.options.snapshotPath, 'utf8'));
      if (!raw || typeof raw !== 'object' || !('version' in raw) || raw.version !== 1 || !('root' in raw) || raw.root !== this.root || !('tree' in raw) || !Array.isArray(raw.tree)) return;
      const entries = new Map<string, Entry>();
      const visit = (nodes: unknown[], parent: string): void => {
        for (const value of nodes) {
          if (!value || typeof value !== 'object') throw new Error('Invalid metadata');
          const node = value as Partial<FileNode>;
          if (typeof node.name !== 'string' || node.name.includes('/') || node.name.includes('\\') || node.path !== (parent ? `${parent}/${node.name}` : node.name) || !visiblePath(node.path) || (node.kind !== 'dir' && node.kind !== 'file') || typeof node.size !== 'number' || !Number.isFinite(node.size) || node.size < 0 || typeof node.mtimeMs !== 'number' || !Number.isFinite(node.mtimeMs) || Math.abs(node.mtimeMs) > 8.64e15 || entries.has(node.path)) throw new Error('Invalid metadata');
          entries.set(node.path, { name: node.name, path: node.path, kind: node.kind, size: node.kind === 'dir' ? 0 : node.size, mtimeMs: node.mtimeMs });
          if (node.kind === 'dir') { if (!Array.isArray(node.children)) throw new Error('Invalid metadata'); visit(node.children, node.path); }
          else if (node.children !== undefined) throw new Error('Invalid metadata');
        }
      };
      visit(raw.tree, '');
      this.entries = entries;
      this.ready = true;
      this.publish();
    } catch { /* Missing/corrupt snapshots are disposable; bootstrap rebuilds. */ }
  }

  private persist(): void {
    if (!this.dirty) return;
    const temporary = `${this.options.snapshotPath}.${randomUUID()}.pending`;
    try {
      writeFileSync(temporary, `{"version":1,"root":${JSON.stringify(this.root)},"tree":${this.serialized}}`, { mode: 0o600, flag: 'wx' });
      renameSync(temporary, this.options.snapshotPath);
      this.dirty = false;
    } catch {
      this.options.onError?.('files_index_persist_failed');
      if (!this.closed) this.persistTimer ??= setTimeout(() => { this.persistTimer = undefined; this.persist(); }, this.options.retryMs ?? 5_000).unref();
    } finally {
      try { rmSync(temporary, { force: true }); } catch { /* Recovery will retry persistence. */ }
    }
  }
}

function visiblePath(path: string): boolean {
  return path.length > 0 && !path.includes('\\') && !path.includes('\0') && path.split('/').every(part => part.length > 0 && !part.startsWith('.')) && path.split('/')[0] !== 'Garbage';
}
function missing(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && ['ENOENT', 'ENOTDIR', 'ELOOP'].includes(String(error.code));
}
