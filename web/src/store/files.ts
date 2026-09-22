import { create } from 'zustand';
import type { FileNodeDTO } from '@pop-agent/shared';
import { session } from '../services/session';
import { filesService } from '../services/artifacts';
import { filesCache, type FilesSnapshot } from '../services/files-cache';

/**
 * The Files tree, shared between the sidebar and the content pane so an
 * upload or a delete on one side is reflected on the other at once. One GET
 * carries the whole tree; everything else is derived from it locally.
 */
interface FilesState {
  tree: FileNodeDTO[] | undefined;
  loading: boolean;
  error: boolean;
  fresh: boolean;
  reload: () => Promise<void>;
  hydrate: () => Promise<void>;
  invalidate: () => void;
}

let reloadGeneration = 0;
let pending: Promise<void> | undefined;
let snapshot: FilesSnapshot | undefined;
let hydration: Promise<void> | undefined;
let invalidationGeneration = 0;

export const useFilesStore = create<FilesState>((set, get) => ({
  tree: undefined, loading: false, error: false, fresh: false,
  hydrate: () => {
    if (hydration) return hydration;
    const namespace = session.filesCacheNamespace();
    if (!namespace || get().tree !== undefined) return Promise.resolve();
    const authGeneration = session.generation();
    const invalidation = invalidationGeneration;
    hydration = filesCache.read(namespace).then(cached => {
      if (cached && session.generation() === authGeneration && invalidation === invalidationGeneration && get().tree === undefined) {
        snapshot = cached;
        set({ tree: cached.tree });
      }
    });
    return hydration;
  },
  invalidate: () => {
    reloadGeneration++;
    invalidationGeneration++;
    hydration = Promise.resolve(); // Never resurrect a pre-mutation disk snapshot.
    pending = undefined;
    set({ fresh: false, loading: false });
  },
  reload: () => {
    if (pending) return pending;
    const namespace = session.filesCacheNamespace();
    if (!namespace) return Promise.resolve();
    const request = ++reloadGeneration;
    const authGeneration = session.generation();
    const isCurrent = () => request === reloadGeneration && authGeneration === session.generation();
    const hydrated = get().hydrate();
    set({ loading: true });
    pending = (async () => {
      try {
        // Paint persisted metadata first and reuse its validator. Storage has a
        // deadline, so denied/blocked IndexedDB cannot hold the network lane.
        await hydrated;
        if (!isCurrent()) return;
        const next = await filesService.tree(snapshot);
        if (isCurrent()) {
          snapshot = next;
          set({ tree: next.tree, fresh: true, error: false });
          void filesCache.write(next, namespace);
        }
      } catch {
        if (isCurrent()) set({ error: true, fresh: false });
      } finally {
        if (isCurrent()) { pending = undefined; set({ loading: false }); }
      }
    })();
    return pending;
  },
}));
filesCache.onReset(() => {
  reloadGeneration++; invalidationGeneration++;
  pending = undefined; snapshot = undefined; hydration = undefined;
  useFilesStore.setState({ tree: undefined, loading: false, error: false, fresh: false });
});
filesCache.onChange(() => useFilesStore.getState().invalidate());

/** The node at `path`, walking the tree segment by segment; '' is nothing. */
export function findNode(tree: FileNodeDTO[], path: string): FileNodeDTO | undefined {
  if (path === '') return undefined;
  let nodes = tree;
  let found: FileNodeDTO | undefined;
  for (const segment of path.split('/')) {
    found = nodes.find((node) => node.name === segment);
    if (found === undefined) return undefined;
    nodes = found.children ?? [];
  }
  return found;
}

/** What the folder at `path` contains; '' is the root's own listing. */
export function childrenOf(tree: FileNodeDTO[], path: string): FileNodeDTO[] {
  if (path === '') return tree;
  return findNode(tree, path)?.children ?? [];
}

/** Every file of the tree, flattened -- the composer's @-mention pool. */
export function flattenFiles(tree: FileNodeDTO[]): FileNodeDTO[] {
  return tree.flatMap((node) =>
    node.kind === 'file' ? [node] : flattenFiles(node.children ?? []),
  );
}

/** Every folder of the tree, flattened -- the Move to… targets. */
export function flattenDirs(tree: FileNodeDTO[]): FileNodeDTO[] {
  return tree.flatMap((node) =>
    node.kind === 'dir' ? [node, ...flattenDirs(node.children ?? [])] : [],
  );
}

/** The folder a path lives in; '' for a top-level entry. */
export function parentDir(path: string): string {
  const at = path.lastIndexOf('/');
  return at === -1 ? '' : path.slice(0, at);
}

/** The last segment of a path -- the entry's own name. */
export function baseName(path: string): string {
  const at = path.lastIndexOf('/');
  return at === -1 ? path : path.slice(at + 1);
}

/** `dir + '/' + name`, except at the root, where there is no slash to add. */
export function joinPath(dir: string, name: string): string {
  return dir === '' ? name : `${dir}/${name}`;
}
