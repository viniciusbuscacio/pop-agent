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
  /**
   * Told when a file leaves the live set (trashed or purged), so its extracted
   * text and embeddings can go. Without this the agent keeps finding and
   * citing a file the user deleted -- the worst kind of bug, silent and
   * embarrassing. The chunks are cheap to rebuild, and a restore rebuilds them
   * through `onStored`.
   */
  onDeindexed?: (artifactId: string) => void;
}

/** A trashed file or folder, with the moment it goes for good. */
export interface TrashEntry {
  kind: 'file' | 'folder';
  id: string;
  name: string;
  /** Where it was, as a path, so the list is readable without opening it. */
  path: string;
  /** Bytes, for files; 0 for a folder. */
  size: number;
  deletedAt: string;
  /** ISO instant after which the sweeper is allowed to purge it. */
  purgeAt: string;
}

/**
 * How long the trash keeps something (popy.spec §14). Thirty days is what
 * Drive, Dropbox and iOS use, so nobody has to learn a new number.
 */
export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** Why a restore did not happen; 'name-taken' is the only recoverable one. */
export type RestoreResult = 'ok' | 'not-found' | 'name-taken';

function purgeAt(deletedAt: string | undefined): string {
  if (deletedAt === undefined) return '';
  return new Date(new Date(deletedAt).getTime() + TRASH_RETENTION_MS).toISOString();
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
   * Sends a folder AND everything under it to the trash -- every descendant
   * folder and every file in the subtree (31/07, extended to the subtree on
   * 02/08, made reversible on 03/08). Nothing is deleted here and no bytes
   * move; the whole subtree is stamped with one instant so it expires, and
   * comes back, as one thing.
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

    const at = new Date(this.deps.clock.now()).toISOString();
    for (const folder of subtree) {
      for (const artifact of this.deps.repo.listByFolder(folder.id)) {
        this.deps.repo.trash(artifact.id, at);
        this.deps.onDeindexed?.(artifact.id);
      }
    }
    // The whole subtree carries the SAME timestamp, so it expires together and
    // the trash can show it as one thing rather than as scattered files whose
    // folder happens to be gone.
    for (const folder of subtree) {
      this.deps.folders.trash(folder.id, at);
    }
    this.deps.onFilesChanged?.();
    return true;
  }

  /**
   * Moves a file to the trash. Reversible for thirty days; the bytes do not
   * move. Its index goes immediately, though -- a deleted file must stop being
   * findable the moment you delete it, not thirty days later.
   */
  delete(id: string): boolean {
    const artifact = this.deps.repo.get(id);
    if (artifact === undefined) return false;
    if (!this.deps.repo.trash(id, new Date(this.deps.clock.now()).toISOString())) return false;
    this.deps.onDeindexed?.(id);
    this.deps.onFilesChanged?.();
    return true;
  }


  // ---- The trash (popy.spec §14) ----

  /**
   * What is in the trash, files and folders together, most recent first.
   *
   * A trashed folder's own files are NOT listed beside it: they went in with
   * it and come back with it, so listing them separately would offer a restore
   * that cannot mean anything on its own. Only the top of each deleted subtree
   * is shown, which is also what the user actually deleted.
   */
  listTrash(): TrashEntry[] {
    const trashedFolders = this.deps.folders.listTrashed();
    const trashedIds = new Set(trashedFolders.map((folder) => folder.id));
    const paths = this.folderPaths();

    const entries: TrashEntry[] = [];
    for (const folder of trashedFolders) {
      // A folder whose parent went to the trash in the same sweep is not the
      // thing that was deleted -- its ancestor is.
      if (trashedIds.has(folder.parentId)) continue;
      entries.push({
        kind: 'folder',
        id: folder.id,
        name: folder.name,
        path: paths.get(folder.parentId) ?? '',
        size: 0,
        deletedAt: folder.deletedAt ?? '',
        purgeAt: purgeAt(folder.deletedAt),
      });
    }
    for (const file of this.deps.repo.listTrashed()) {
      if (trashedIds.has(file.folderId)) continue;
      entries.push({
        kind: 'file',
        id: file.id,
        name: file.name,
        path: paths.get(file.folderId) ?? '',
        size: file.size,
        deletedAt: file.deletedAt ?? '',
        purgeAt: purgeAt(file.deletedAt),
      });
    }
    return entries.sort((left, right) => right.deletedAt.localeCompare(left.deletedAt));
  }

  /**
   * Puts a file back where it was.
   *
   * If the folder it lived in is also in the trash, that comes back too, and
   * so does everything above it. The alternative -- dropping the file at the
   * root -- would quietly move something the user only asked to undelete, and
   * a folder's parent is fixed at creation (§6), so there is no reparenting to
   * fall back on anyway.
   */
  restore(id: string): RestoreResult {
    const file = this.deps.repo.getTrashed(id);
    if (file === undefined) return 'not-found';
    const ancestors = this.restoreAncestors(file.folderId);
    if (ancestors !== 'ok') return ancestors;
    if (!this.deps.repo.restore(id)) return 'not-found';
    // Back in the live set, so it has to be findable again.
    this.deps.onStored?.(id);
    this.deps.onFilesChanged?.();
    return 'ok';
  }

  /** Puts a folder and its whole subtree back, ancestors included. */
  restoreFolder(id: string): RestoreResult {
    const folder = this.deps.folders.getTrashed(id);
    if (folder === undefined) return 'not-found';
    const ancestors = this.restoreAncestors(folder.parentId);
    if (ancestors !== 'ok') return ancestors;
    if (this.nameTaken(folder.parentId, folder.name)) return 'name-taken';

    // Everything stamped with this folder's instant, at or below it: one
    // delete produced them, one restore undoes it.
    for (const descendant of this.subtreeOfTrashed(folder)) {
      this.deps.folders.restore(descendant.id);
      for (const file of this.deps.repo.listTrashed()) {
        if (file.folderId !== descendant.id) continue;
        if (file.deletedAt !== folder.deletedAt) continue;
        this.deps.repo.restore(file.id);
        this.deps.onStored?.(file.id);
      }
    }
    this.deps.onFilesChanged?.();
    return 'ok';
  }

  /** Deletes a trashed file for good: record, bytes and every archived copy. */
  purge(id: string): boolean {
    const file = this.deps.repo.getTrashed(id);
    if (file === undefined) return false;
    this.purgeFile(file);
    this.deps.onFilesChanged?.();
    return true;
  }

  /** Deletes a trashed folder and its whole subtree for good. */
  purgeFolder(id: string): boolean {
    const folder = this.deps.folders.getTrashed(id);
    if (folder === undefined) return false;
    const subtree = this.subtreeOfTrashed(folder);
    const ids = new Set(subtree.map((entry) => entry.id));
    for (const file of this.deps.repo.listTrashed()) {
      if (ids.has(file.folderId)) this.purgeFile(file);
    }
    // Deepest first: no parent goes while a child still references it.
    for (const entry of subtree.reverse()) this.deps.folders.delete(entry.id);
    this.deps.onFilesChanged?.();
    return true;
  }

  /** Empties the trash now, whatever the retention window says. */
  emptyTrash(): number {
    return this.purgeTrashed(this.deps.folders.listTrashed(), this.deps.repo.listTrashed());
  }

  /**
   * What the daily sweeper calls: everything whose thirty days are up. The
   * cutoff is computed from the clock this service already owns, so a test can
   * move time instead of waiting a month.
   */
  purgeExpired(retentionMs = TRASH_RETENTION_MS): number {
    const cutoff = new Date(this.deps.clock.now() - retentionMs).toISOString();
    return this.purgeTrashed(
      this.deps.folders.listTrashedBefore(cutoff),
      this.deps.repo.listTrashedBefore(cutoff),
    );
  }

  private purgeTrashed(folders: Folder[], files: Artifact[]): number {
    let count = 0;
    for (const file of files) {
      this.purgeFile(file);
      count += 1;
    }
    // Deepest first, so a parent never goes while a child still points at it.
    const deepestFirst = [...folders].sort(
      (left, right) => this.depthOf(right, folders) - this.depthOf(left, folders),
    );
    for (const folder of deepestFirst) {
      this.deps.folders.delete(folder.id);
      count += 1;
    }
    if (count > 0) this.deps.onFilesChanged?.();
    return count;
  }

  private purgeFile(file: Artifact): void {
    for (const version of this.deps.repo.listVersions(file.id)) {
      // The current bytes live at the canonical path, not under a version name.
      if (version.version !== file.version) {
        this.deps.store.removeVersion(file.chatId, file.id, version.version);
      }
    }
    this.deps.repo.delete(file.id);
    this.deps.store.remove(file.chatId, file.id);
    this.deps.onDeindexed?.(file.id);
  }

  /** How many trashed ancestors a folder has inside the given set. */
  private depthOf(folder: Folder, within: Folder[]): number {
    const byId = new Map(within.map((entry) => [entry.id, entry]));
    let depth = 0;
    let current = byId.get(folder.parentId);
    // The guard is the set size: a cycle must not hang a sweep.
    while (current !== undefined && depth <= within.length) {
      depth += 1;
      current = byId.get(current.parentId);
    }
    return depth;
  }

  /** A trashed folder and every trashed folder under it, parents first. */
  private subtreeOfTrashed(root: Folder): Folder[] {
    const trashed = this.deps.folders.listTrashed();
    const childrenOf = new Map<string, Folder[]>();
    for (const folder of trashed) {
      const siblings = childrenOf.get(folder.parentId) ?? [];
      siblings.push(folder);
      childrenOf.set(folder.parentId, siblings);
    }
    const out: Folder[] = [];
    const stack = [root];
    const seen = new Set<string>();
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined || seen.has(current.id)) continue;
      seen.add(current.id);
      out.push(current);
      for (const child of childrenOf.get(current.id) ?? []) stack.push(child);
    }
    return out;
  }

  /** Brings back every trashed folder on the way up from `folderId`. */
  private restoreAncestors(folderId: string): RestoreResult {
    const chain: Folder[] = [];
    let current = folderId;
    while (current !== '') {
      if (this.deps.folders.get(current) !== undefined) break; // already live
      const trashed = this.deps.folders.getTrashed(current);
      if (trashed === undefined) break; // purged for good: stop climbing
      if (chain.some((entry) => entry.id === trashed.id)) break; // cycle guard
      chain.push(trashed);
      current = trashed.parentId;
    }
    // Outermost first, so each one has a live parent by the time it lands.
    for (const folder of chain.reverse()) {
      if (this.nameTaken(folder.parentId, folder.name)) return 'name-taken';
      this.deps.folders.restore(folder.id);
    }
    return 'ok';
  }

  /** Whether a live sibling already answers to that name. */
  private nameTaken(parentId: string, name: string): boolean {
    return this.deps.folders
      .list()
      .some((folder) => folder.parentId === parentId && folder.name === name);
  }

  /** Every live folder id to its full path, for reading the trash list. */
  private folderPaths(): Map<string, string> {
    const all = [...this.deps.folders.list(), ...this.deps.folders.listTrashed()];
    const byId = new Map(all.map((folder) => [folder.id, folder]));
    const paths = new Map<string, string>([['', '']]);
    const pathOf = (id: string): string => {
      const cached = paths.get(id);
      if (cached !== undefined) return cached;
      const folder = byId.get(id);
      if (folder === undefined) return '';
      // Marked before recursing: a corrupt parent chain must not loop.
      paths.set(id, folder.name);
      const parent = pathOf(folder.parentId);
      const full = parent === '' ? folder.name : `${parent}/${folder.name}`;
      paths.set(id, full);
      return full;
    };
    for (const folder of all) pathOf(folder.id);
    return paths;
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
