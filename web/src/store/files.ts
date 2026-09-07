import { create } from 'zustand';
import type { FileNodeDTO } from '@pop-agent/shared';
import { filesService } from '../services/artifacts';

/**
 * The Files tree, shared between the sidebar and the content pane so an
 * upload or a delete on one side is reflected on the other at once. One GET
 * carries the whole tree; everything else is derived from it locally.
 */
interface FilesState {
  tree: FileNodeDTO[] | undefined;
  reload: () => Promise<void>;
}

export const useFilesStore = create<FilesState>((set) => ({
  tree: undefined,
  reload: async () => {
    try {
      const { tree } = await filesService.tree();
      set({ tree });
    } catch {
      // A failed refresh is not an empty folder; retain the last known list.
      set((state) => ({ tree: state.tree ?? [] }));
    }
  },
}));

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
