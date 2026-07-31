import type { Artifact } from '../../domain/artifacts/artifact.js';

/**
 * Persistence for artifact records (popy.spec §6). The bytes are the store's
 * job; this keeps the metadata and the per-chat listing.
 */
export interface ArtifactRepo {
  /**
   * Stores the record. On the astronomically unlikely primary-key collision it
   * re-draws the id once and retries, per §6 -- it never fails or overwrites.
   * Returns the stored artifact (its id may differ from the input's after a
   * re-draw).
   */
  insert(artifact: Artifact): Artifact;
  get(id: string): Artifact | undefined;
  listByChat(chatId: string): Artifact[];
  delete(id: string): boolean;
}
