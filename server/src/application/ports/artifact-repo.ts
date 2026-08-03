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
  /** A live file. A trashed one is invisible here -- use {@link getTrashed}. */
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
  /**
   * Removes the record for good. The trash calls this only after the retention
   * window; everything the user sees goes through {@link trash} first.
   */
  delete(id: string): boolean;
  /** Moves it to the trash. Every listing above stops returning it at once. */
  trash(id: string, at: string): boolean;
  /** Brings it back. The caller has already checked the name is free. */
  restore(id: string): boolean;
  /** What is in the trash, most recently deleted first. */
  listTrashed(): Artifact[];
  /** One trashed file by id -- the only way to reach it before restoring. */
  getTrashed(id: string): Artifact | undefined;
  /** Trashed before this ISO instant: what the sweeper is allowed to purge. */
  listTrashedBefore(cutoff: string): Artifact[];
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
