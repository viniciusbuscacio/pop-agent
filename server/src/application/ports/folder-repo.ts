import type { Folder } from '../../domain/artifacts/folder.js';

/** Folder records for Files (popy.spec §14). */
export interface FolderRepo {
  /** Stores the folder; a duplicate name throws (the UNIQUE is the contract). */
  insert(folder: Folder): Folder;
  get(id: string): Folder | undefined;
  list(): Folder[];
  rename(id: string, name: string): boolean;
  delete(id: string): boolean;
}
