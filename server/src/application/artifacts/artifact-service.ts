import { createArtifact, type Artifact, type ArtifactSource } from '../../domain/artifacts/artifact.js';
import { createFolder, type Folder } from '../../domain/artifacts/folder.js';
import type { Clock } from '../ports/clock.js';
import type { ArtifactRepo, ArtifactVersion } from '../ports/artifact-repo.js';
import type { FolderRepo } from '../ports/folder-repo.js';
import type { ArtifactStore } from '../ports/artifact-store.js';
import {
  buildSignedLink,
  buildVersionLink,
  verifyDownload,
  verifyVersionDownload,
  type LinkCheck,
  type SignedLink,
} from './artifact-download.js';

/**
 * Artifacts as a feature (popy.spec §14, RF-001–008): the agent's outputs and
 * the user's uploads, tracked per chat, listed, deleted, and downloaded only
 * through an HMAC-signed link. The record and the bytes are kept together here
 * so a delete removes both and a download resolves both.
 */
export interface ArtifactServiceDeps {
  repo: ArtifactRepo;
  folders: FolderRepo;
  store: ArtifactStore;
  /** Derived link-signing key, from `secret.key` (never a new secret). */
  secretKey: Buffer;
  clock: Clock;
  /** Told after bytes+record are stored, so the file index can trail along. */
  onStored?: (artifactId: string) => void;
  /**
   * Told after any change to the set of Files -- a file added, renamed, moved
   * or deleted, or a folder created, renamed or deleted -- so the Files search
   * index can be rebuilt (popy.spec §14). Kept as a callback so this service
   * does not depend on the index.
   */
  onFilesChanged?: () => void;
}

export interface NewArtifactInput {
  /** Empty = uploaded straight into Files, no chat. */
  chatId: string;
  /** Empty = the root of Files. */
  folderId?: string;
  name: string;
  mime: string;
  source: ArtifactSource;
}

export type DownloadResolution =
  | { status: 'ok'; artifact: Artifact; path: string }
  | { status: 'not-found' }
  | { status: Exclude<LinkCheck, 'ok'> };

export class ArtifactService {
  constructor(private readonly deps: ArtifactServiceDeps) {}

  /** Stores bytes and their record. A re-save under the same name in the same
   * chat becomes a new version, keeping the previous bytes (RF-018). */
  create(input: NewArtifactInput, bytes: Buffer): Artifact {
    const now = new Date(this.deps.clock.now()).toISOString();

    const existing =
      input.chatId === ''
        ? this.deps.repo
            .listByFolder(input.folderId ?? '')
            .filter((a) => a.chatId === '' && a.name === input.name)
            .at(-1)
        : this.findByName(input.chatId, input.name);
    if (existing !== undefined) {
      // Snapshot the current latest bytes, then overwrite with the new version.
      this.deps.store.archive(existing.chatId, existing.id, existing.version);
      const version = existing.version + 1;
      this.deps.repo.addVersion(existing.id, {
        version,
        mime: input.mime,
        size: bytes.length,
        source: input.source,
        createdAt: now,
      });
      this.deps.repo.updateLatest(existing.id, {
        mime: input.mime,
        size: bytes.length,
        version,
        updatedAt: now,
      });
      this.deps.store.write(existing.chatId, existing.id, bytes);
      this.deps.onStored?.(existing.id);
      this.deps.onFilesChanged?.();
      return { ...existing, mime: input.mime, size: bytes.length, version, updatedAt: now };
    }

    const stored = this.deps.repo.insert(createArtifact({ ...input, size: bytes.length }, now));
    this.deps.repo.addVersion(stored.id, {
      version: 1,
      mime: stored.mime,
      size: stored.size,
      source: stored.source,
      createdAt: now,
    });
    this.deps.store.write(stored.chatId, stored.id, bytes);
    this.deps.onStored?.(stored.id);
    this.deps.onFilesChanged?.();
    return stored;
  }

  /** The version history, newest first (RF-018/019). */
  listVersions(id: string): ArtifactVersion[] {
    return this.deps.repo.listVersions(id);
  }

  list(chatId: string): Artifact[] {
    return this.deps.repo.listByChat(chatId);
  }

  /** Every artifact across every chat, newest first. */
  listAll(): Artifact[] {
    return this.deps.repo.listAll();
  }

  get(id: string): Artifact | undefined {
    return this.deps.repo.get(id);
  }

  /** The latest artifact in a chat with a given display name (RF-017). */
  findByName(chatId: string, name: string): Artifact | undefined {
    const matches = this.deps.repo.listByChat(chatId).filter((a) => a.name === name);
    return matches.length === 0 ? undefined : matches[matches.length - 1];
  }

  /** Reads an artifact's metadata and bytes together, for the agent to open. */
  read(id: string): { artifact: Artifact; bytes: Buffer } | undefined {
    const artifact = this.deps.repo.get(id);
    if (artifact === undefined) return undefined;
    const bytes = this.deps.store.read(artifact.chatId, id);
    if (bytes === undefined) return undefined;
    return { artifact, bytes };
  }

  /** Renames a file's display name. */
  rename(id: string, name: string): boolean {
    const renamed = this.deps.repo.rename(id, name, new Date(this.deps.clock.now()).toISOString());
    if (renamed) this.deps.onFilesChanged?.();
    return renamed;
  }

  /** Moves a file to a folder ('' = the root). The folder must exist. */
  move(id: string, folderId: string): boolean {
    if (folderId !== '' && this.deps.folders.get(folderId) === undefined) return false;
    const moved = this.deps.repo.setFolder(id, folderId, new Date(this.deps.clock.now()).toISOString());
    if (moved) this.deps.onFilesChanged?.();
    return moved;
  }

  listFolders(): Folder[] {
    return this.deps.folders.list();
  }

  /** One folder by id, or undefined -- used to validate a parent before create. */
  getFolder(id: string): Folder | undefined {
    return this.deps.folders.get(id);
  }

  /**
   * Creates a folder, optionally inside another ('' = the root). The caller
   * must have checked the parent exists; a duplicate name among siblings throws
   * (the UNIQUE index is the contract), surfaced as a conflict by the route.
   */
  createFolder(name: string, parentId = ''): Folder {
    const folder = this.deps.folders.insert(
      createFolder(name, parentId, new Date(this.deps.clock.now()).toISOString()),
    );
    this.deps.onFilesChanged?.();
    return folder;
  }

  renameFolder(id: string, name: string): boolean {
    const renamed = this.deps.folders.rename(id, name);
    if (renamed) this.deps.onFilesChanged?.();
    return renamed;
  }

  /**
   * Deletes a folder AND everything under it -- every descendant folder and
   * every file in the subtree, records and bytes both; the UI warns before
   * calling (decision of 31/07, extended to the subtree on 02/08). Files go
   * first so no artifact FK blocks a folder, and folders go deepest-first so no
   * parent is removed while a child still points at it.
   */
  deleteFolder(id: string): boolean {
    const root = this.deps.folders.get(id);
    if (root === undefined) return false;

    const all = this.deps.folders.list();
    const childrenOf = new Map<string, Folder[]>();
    for (const folder of all) {
      const siblings = childrenOf.get(folder.parentId) ?? [];
      siblings.push(folder);
      childrenOf.set(folder.parentId, siblings);
    }

    // Pre-order walk: a parent always lands before its descendants, so the
    // reverse is a safe deletion order (descendants first).
    const subtree: Folder[] = [];
    const stack: Folder[] = [root];
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined) break;
      subtree.push(current);
      for (const child of childrenOf.get(current.id) ?? []) stack.push(child);
    }

    for (const folder of subtree) {
      for (const artifact of this.deps.repo.listByFolder(folder.id)) {
        this.deps.repo.delete(artifact.id);
        this.deps.store.remove(artifact.chatId, artifact.id);
      }
    }
    for (const folder of subtree.reverse()) {
      this.deps.folders.delete(folder.id);
    }
    this.deps.onFilesChanged?.();
    return true;
  }

  /** Removes the record and the bytes. Returns false if there was no such id. */
  delete(id: string): boolean {
    const artifact = this.deps.repo.get(id);
    if (artifact === undefined) return false;
    this.deps.repo.delete(id);
    this.deps.store.remove(artifact.chatId, id);
    this.deps.onFilesChanged?.();
    return true;
  }

  /** Mints a fresh signed link, or undefined when the artifact is gone. */
  mintLink(id: string, ttlMs?: number): SignedLink | undefined {
    if (this.deps.repo.get(id) === undefined) return undefined;
    return buildSignedLink(this.deps.secretKey, id, this.deps.clock.now(), ttlMs);
  }

  /** Mints a signed link to one archived version, or undefined if absent. */
  mintVersionLink(id: string, version: number, ttlMs?: number): SignedLink | undefined {
    const artifact = this.deps.repo.get(id);
    if (artifact === undefined) return undefined;
    if (!this.deps.repo.listVersions(id).some((v) => v.version === version)) return undefined;
    return buildVersionLink(this.deps.secretKey, id, version, this.deps.clock.now(), ttlMs);
  }

  /** Validates a download request end to end for the public route. */
  resolveDownload(id: string, expires: string | undefined, sig: string | undefined): DownloadResolution {
    const check = verifyDownload(this.deps.secretKey, id, expires, sig, this.deps.clock.now());
    if (check !== 'ok') return { status: check };
    const artifact = this.deps.repo.get(id);
    if (artifact === undefined) return { status: 'not-found' };
    return { status: 'ok', artifact, path: this.deps.store.pathOf(artifact.chatId, id) };
  }

  /** Validates a versioned download request for the public route (RF-018). */
  resolveVersionDownload(
    id: string,
    version: number,
    expires: string | undefined,
    sig: string | undefined,
  ): DownloadResolution {
    const check = verifyVersionDownload(
      this.deps.secretKey,
      id,
      version,
      expires,
      sig,
      this.deps.clock.now(),
    );
    if (check !== 'ok') return { status: check };
    const artifact = this.deps.repo.get(id);
    if (artifact === undefined) return { status: 'not-found' };
    if (!this.deps.repo.listVersions(id).some((v) => v.version === version)) {
      return { status: 'not-found' };
    }
    // The latest version lives at the canonical path; older ones are archived.
    const path =
      version === artifact.version
        ? this.deps.store.pathOf(artifact.chatId, id)
        : this.deps.store.pathOfVersion(artifact.chatId, id, version);
    return { status: 'ok', artifact, path };
  }
}
