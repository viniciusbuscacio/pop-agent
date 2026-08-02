/**
 * The Files search index (popy.spec §14, decision of 02/08): a materialised
 * path for every folder and file, so the search matches a name or any path
 * segment anywhere in the tree, and folders are found -- not only files.
 *
 * It is a cache, never a source of truth. {@link PathIndexService} rebuilds it
 * whole from the folders and artifacts tables whenever Files change; this port
 * is just "replace the lot" and "find the matches".
 */
export interface PathIndexEntry {
  kind: 'folder' | 'file';
  /** The folder id or the artifact id. */
  refId: string;
  /** The display name. */
  name: string;
  /** The full slash path from the root, e.g. `Projetos/specs/popy.md`. */
  path: string;
  /** The containing folder id; '' = the root of Files. */
  parentId: string;
}

export interface PathIndexRepo {
  /** Replaces the whole index in one transaction -- a rebuild, never a delta. */
  replaceAll(entries: readonly PathIndexEntry[]): void;
  /**
   * Folders and files whose name or path contains `query`, case-insensitive.
   * Folders come first, then files; both ordered by path. Capped at `limit`.
   */
  search(query: string, limit: number): PathIndexEntry[];
}
