import { entityId } from '../ids.js';

/**
 * A folder in Files (popy.spec §14, decision of 31/07): a flat, user-managed
 * grouping for artifacts. No nesting -- folders hold files, the root holds
 * folders and loose files, and that is the whole model.
 */
export interface Folder {
  id: string;
  name: string;
  createdAt: string;
}

export function createFolder(name: string, now: string): Folder {
  return { id: entityId('folder'), name, createdAt: now };
}
