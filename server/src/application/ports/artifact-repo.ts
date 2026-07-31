import type { Artifact } from '../../domain/artifacts/artifact.js';

/** One entry in an artifact's version history (popy.spec §14, RF-018/019). */
export interface ArtifactVersion {
  version: number;
  mime: string;
  size: number;
  source: 'agent' | 'upload';
  createdAt: string;
}

/**
 * Persistence for artifact records (popy.spec §6). The bytes are the store's
 * job; this keeps the metadata, the per-chat listing and the version history.
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
  /** Every artifact, newest first -- the cross-chat Files view. */
  listAll(): Artifact[];
  /** The files sitting in one folder ('' = the root). */
  listByFolder(folderId: string): Artifact[];
  /** Renames the display name. */
  rename(id: string, name: string, at: string): boolean;
  /** Moves the file to a folder ('' = the root). */
  setFolder(id: string, folderId: string, at: string): boolean;
  delete(id: string): boolean;
  /** Appends a version-history row. */
  addVersion(id: string, version: ArtifactVersion): void;
  /** The version history, newest first. */
  listVersions(id: string): ArtifactVersion[];
  /** Points the record at a new latest version (mime/size/version/updatedAt). */
  updateLatest(
    id: string,
    next: { mime: string; size: number; version: number; updatedAt: string },
  ): void;
}
