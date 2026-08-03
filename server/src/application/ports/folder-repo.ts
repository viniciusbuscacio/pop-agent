import type { Folder } from '../../domain/artifacts/folder.js';

/** Folder records for Files (popy.spec §14). */
export interface FolderRepo {
  /** Stores the folder; a duplicate name throws (the UNIQUE is the contract). */
  insert(folder: Folder): Folder;
  get(id: string): Folder | undefined;
  list(): Folder[];
  rename(id: string, name: string): boolean;
  /** Removes the record for good; only the trash sweeper and a purge call it. */
  delete(id: string): boolean;
  trash(id: string, at: string): boolean;
  restore(id: string): boolean;
  listTrashed(): Folder[];
  getTrashed(id: string): Folder | undefined;
  listTrashedBefore(cutoff: string): Folder[];
}
