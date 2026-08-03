import { entityId } from '../ids.js';

/**
 * A folder in Files (popy.spec §14, decision of 02/08): a user-managed grouping
 * for artifacts, now nestable. A folder may hold both folders and files; the
 * root holds top-level folders and loose files. The parent is fixed at creation
 * and never changes -- there is no move -- so a cycle cannot form.
 */
export interface Folder {
  id: string;
  name: string;
  /** The containing folder id; '' = the root of Files. */
  parentId: string;
  createdAt: string;
  /** When it went to the trash, ISO. Absent means live. */
  deletedAt?: string;
}

export function createFolder(name: string, parentId: string, now: string): Folder {
  return { id: entityId('folder'), name, parentId, createdAt: now };
}
