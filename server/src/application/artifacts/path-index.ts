import type { Folder } from '../../domain/artifacts/folder.js';
import type { ArtifactRepo } from '../ports/artifact-repo.js';
import type { FolderRepo } from '../ports/folder-repo.js';
import type { PathIndexEntry, PathIndexRepo } from '../ports/path-index-repo.js';

/**
 * The Files search index as a feature (popy.spec §14, decision of 02/08).
 *
 * Search used to filter the loaded file list in the browser and hide folders
 * entirely; with nested folders that misses both folders and anything below the
 * open one. So the whole tree -- every folder and file, with its full path --
 * is materialised in `path_index`, and search runs against that.
 *
 * The index is a cache: {@link reindex} rebuilds it whole from the folders and
 * artifacts tables. A rebuild is deliberately total rather than incremental --
 * a personal server's Files are small, and "rewrite the lot" cannot drift out
 * of sync the way a hand-maintained delta can. It is called after every Files
 * mutation, once at boot, and once a day as a safety net.
 */
export interface PathIndexServiceDeps {
  folders: FolderRepo;
  artifacts: ArtifactRepo;
  index: PathIndexRepo;
  onJournal?: (line: string) => void;
}

/** A search match, as the service returns it (mapped to DTOs at the edge). */
export interface FilesSearchHit {
  kind: 'folder' | 'file';
  refId: string;
  name: string;
  path: string;
  parentId: string;
}

export class PathIndexService {
  constructor(private readonly deps: PathIndexServiceDeps) {}

  /** Rebuilds the whole Files index from folders + artifacts. */
  reindex(): void {
    const folders = this.deps.folders.list();
    const pathOf = buildFolderPaths(folders);
    const entries: PathIndexEntry[] = [];

    for (const folder of folders) {
      entries.push({
        kind: 'folder',
        refId: folder.id,
        name: folder.name,
        path: pathOf.get(folder.id) ?? folder.name,
        parentId: folder.parentId,
      });
    }

    const files = this.deps.artifacts.listAll();
    for (const file of files) {
      const base = file.folderId === '' ? '' : pathOf.get(file.folderId) ?? '';
      entries.push({
        kind: 'file',
        refId: file.id,
        name: file.name,
        path: base === '' ? file.name : `${base}/${file.name}`,
        parentId: file.folderId,
      });
    }

    this.deps.index.replaceAll(entries);
    this.deps.onJournal?.(
      `popy files reindex: folders=${String(folders.length)} files=${String(files.length)}`,
    );
  }

  /** Folders and files matching the query; empty query returns nothing. */
  search(query: string, limit = 60): FilesSearchHit[] {
    if (query.trim() === '') return [];
    return this.deps.index.search(query.trim(), limit).map((entry) => ({
      kind: entry.kind,
      refId: entry.refId,
      name: entry.name,
      path: entry.path,
      parentId: entry.parentId,
    }));
  }
}

/**
 * The full slash path of every folder, resolved through its parents. Memoised,
 * and guarded against a cycle that construction should make impossible (a
 * parent is fixed at creation and never moved) but a hand-edited database
 * could still introduce.
 */
function buildFolderPaths(folders: readonly Folder[]): Map<string, string> {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const cache = new Map<string, string>();

  function resolve(id: string, seen: Set<string>): string {
    const cached = cache.get(id);
    if (cached !== undefined) return cached;
    const folder = byId.get(id);
    if (folder === undefined) return '';
    if (seen.has(id)) return folder.name;
    seen.add(id);
    const parentPath = folder.parentId === '' ? '' : resolve(folder.parentId, seen);
    const path = parentPath === '' ? folder.name : `${parentPath}/${folder.name}`;
    cache.set(id, path);
    return path;
  }

  for (const folder of folders) resolve(folder.id, new Set());
  return cache;
}
