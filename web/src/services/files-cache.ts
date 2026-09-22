import type { FileNodeDTO } from '@pop-agent/shared';
import { createCoalescedWriter } from './coalesced-writer';

const DB = 'pop-agent-files-cache';
const LIMIT = 8 * 1024 * 1024;
const STORAGE_TIMEOUT = 1_500;
let generation = 0;
const writer = createCoalescedWriter();
let clearing = Promise.resolve();
const resets = new Set<() => void>();
const changes = new Set<() => void>();
export interface FilesSnapshot { tree: FileNodeDTO[]; etag?: string }

/** Allowlist metadata only, including on reads of an obsolete/corrupt database. */
export function safeFilesSnapshot(value: unknown): FilesSnapshot | undefined {
  let count = 0;
  function nodes(value: unknown, parent = '', depth = 0): FileNodeDTO[] {
    if (!Array.isArray(value) || depth > 128) throw new Error('Invalid tree');
    const names = new Set<string>();
    return value.map((item: unknown) => {
      if (!item || typeof item !== 'object' || ++count > 100_000) throw new Error('Invalid node');
      const n = item as Record<string, unknown>;
      if (typeof n.name !== 'string' || !n.name || /[/\\\0]/.test(n.name) || n.name.startsWith('.') || names.has(n.name)
        || (!parent && n.name === 'Garbage') || n.path !== `${parent}${n.name}`
        || (n.kind !== 'file' && n.kind !== 'dir') || typeof n.size !== 'number' || !Number.isFinite(n.size) || n.size < 0
        || typeof n.mtime !== 'string' || !Number.isFinite(Date.parse(n.mtime))) throw new Error('Invalid metadata');
      names.add(n.name);
      return { name: n.name, path: n.path, kind: n.kind, size: n.size, mtime: n.mtime,
        ...(n.kind === 'dir' ? { children: nodes(n.children, `${n.path}/`, depth + 1) } : {}) };
    });
  }
  try {
    if (!value || typeof value !== 'object') return undefined;
    const snapshot = value as Record<string, unknown>;
    const tree = nodes(snapshot.tree);
    // ETags are opaque HTTP validators, not a client-defined hash format.
    const etag = typeof snapshot.etag === 'string' && snapshot.etag.length <= 512
      && /^(W\/)?"[\x21\x23-\x7e]*"$/.test(snapshot.etag) ? snapshot.etag : undefined;
    return { tree, ...(etag ? { etag } : {}) };
  } catch { return undefined; }
}

function boundedSnapshot(value: unknown): FilesSnapshot | undefined {
  const safe = safeFilesSnapshot(value);
  return safe && new TextEncoder().encode(JSON.stringify(safe)).length <= LIMIT ? safe : undefined;
}

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    let finished = false;
    const fail = () => {
      finished = true; clearTimeout(timer); reject(new Error('Storage unavailable'));
    };
    const timer = setTimeout(fail, STORAGE_TIMEOUT);
    request.onupgradeneeded = () => request.result.createObjectStore('snapshots');
    request.onsuccess = () => {
      if (finished) { request.result.close(); return; }
      finished = true; clearTimeout(timer); resolve(request.result);
    };
    request.onerror = request.onblocked = fail;
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise(resolve => {
    const finish = () => { clearTimeout(timer); resolve(); };
    const timer = setTimeout(() => { try { tx.abort(); } catch { /* Already finished. */ } finish(); }, STORAGE_TIMEOUT);
    tx.oncomplete = tx.onerror = tx.onabort = finish;
  });
}

export const filesCache = {
  onReset(listener: () => void): void { resets.add(listener); },
  onChange(listener: () => void): void { changes.add(listener); },
  changed(): void { for (const listener of changes) listener(); },
  async read(namespace: string): Promise<FilesSnapshot | undefined> {
    const started = generation;
    let db: IDBDatabase | undefined;
    try {
      await clearing;
      db = await database();
      if (started !== generation) return undefined;
      const tx = db.transaction('snapshots');
      let result: FilesSnapshot | undefined;
      const done = transactionDone(tx);
      const request = tx.objectStore('snapshots').get(namespace);
      request.onsuccess = () => { result = boundedSnapshot(request.result); };
      await done;
      return started === generation ? result : undefined;
    } catch { return undefined; }
    finally { db?.close(); }
  },
  write(snapshot: FilesSnapshot, namespace: string): Promise<void> {
    const started = generation;
    return writer.add('tree', async () => {
      let db: IDBDatabase | undefined;
      try {
        if (started !== generation) return;
        const safe = boundedSnapshot(snapshot);
        if (!safe) return;
        db = await database();
        if (started !== generation) return;
        const tx = db.transaction('snapshots', 'readwrite');
        const done = transactionDone(tx);
        // One snapshot in this origin, not one unbounded entry per login.
        try {
          tx.objectStore('snapshots').clear();
          tx.objectStore('snapshots').put(safe, namespace);
        } catch {
          tx.abort(); // A synchronous put failure must not commit the clear.
        }
        await done;
      } catch { /* Best effort: quota/denial never breaks online Files. */ }
      finally { db?.close(); }
    });
  },
  clear(): void {
    generation++;
    writer.clear();
    for (const listener of resets) listener();
    // Serialize deletion with old writes and new-session writes. A blocked
    // deleteDatabase can otherwise unexpectedly delete a newer session's cache.
    clearing = writer.add('clear', async () => {
      let db: IDBDatabase | undefined;
      try {
        db = await database();
        const tx = db.transaction('snapshots', 'readwrite');
        const done = transactionDone(tx);
        tx.objectStore('snapshots').clear();
        await done;
      } catch { /* Optional storage. */ }
      finally { db?.close(); }
    });
  },
};
