import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { cleanRelative, isHiddenPath, resolveInFiles } from '../../domain/files/safe-path.js';
import type { Clock } from '../ports/clock.js';

/**
 * Files as a plain folder (pop-agent.spec §14, "Files as a plain folder").
 *
 * `POP_AGENT_DATA_DIR/files/` is the single source of truth: real names, real
 * subfolders, no catalog. This service is the one place that touches the tree
 * on behalf of the app -- the tab, the upload, the download, the agent's
 * delete tool. Deleting moves into `Garbage/` and notes where the entry came
 * from in a hidden `.garbage.json` (the desktop `.trashinfo` idea); restoring
 * moves it back; a daily sweep purges what is older than thirty days.
 *
 * Self-healing on purpose: a file put into Garbage by hand has no note --
 * it purges by its own mtime and restores to the root; a note whose file is
 * gone is dropped. Nothing here can wedge on a half-truth.
 */

export const GARBAGE_DIR = 'Garbage';
const GARBAGE_INFO = '.garbage.json';

/** Thirty days, same number Drive, Dropbox and iOS use. */
export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export interface FileNode {
  name: string;
  /** Relative to the Files root, `/`-separated: `reports/pesca.pdf`. */
  path: string;
  kind: 'file' | 'dir';
  /** Bytes for a file; 0 for a folder. */
  size: number;
  mtimeMs: number;
  /** Present on folders only. */
  children?: FileNode[];
}

export interface GarbageEntry {
  /** The entry's name inside `Garbage/`. */
  name: string;
  /** Where it lived, relative to the root; restore puts it back there. */
  originalPath: string;
  kind: 'file' | 'dir';
  size: number;
  deletedAt: string;
  /** ISO instant after which the sweeper may purge it. */
  purgeAt: string;
}

interface GarbageNote {
  originalPath: string;
  deletedAt: string;
}

export type MoveResult = 'ok' | 'not-found' | 'target-exists';
export type RestoreResult = 'ok' | 'not-found' | 'name-taken';

export class FilesService {
  constructor(
    private readonly deps: {
      /** Absolute path of the Files root (`POP_AGENT_DATA_DIR/files/`). */
      root: string;
      clock: Clock;
      /** Told after any mutation, so the session catalog can refresh. */
      onChanged?: () => void;
    },
  ) {
    mkdirSync(join(deps.root, GARBAGE_DIR), { recursive: true, mode: 0o700 });
  }

  /** The live tree: folders first, then files, both by name; Garbage and dotfiles unlisted. */
  tree(): FileNode[] {
    return this.walk('');
  }

  stat(relativePath: string): { kind: 'file' | 'dir'; size: number; mtimeMs: number } | undefined {
    const target = this.resolveVisible(relativePath);
    try {
      const stat = statSync(target);
      return {
        kind: stat.isDirectory() ? 'dir' : 'file',
        size: stat.isDirectory() ? 0 : stat.size,
        mtimeMs: stat.mtimeMs,
      };
    } catch {
      return undefined;
    }
  }

  read(relativePath: string): Buffer | undefined {
    const target = this.resolveVisible(relativePath);
    try {
      const stat = statSync(target);
      if (!stat.isFile()) return undefined;
      return readFileSync(target);
    } catch {
      return undefined;
    }
  }

  /** Writes a file, creating parents. Overwrite is the feature, not a hazard. */
  write(relativePath: string, bytes: Buffer): void {
    const target = this.resolveVisible(relativePath);
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    writeFileSync(target, bytes, { mode: 0o600 });
    this.deps.onChanged?.();
  }

  mkdir(relativePath: string): void {
    const target = this.resolveVisible(relativePath);
    mkdirSync(target, { recursive: true, mode: 0o700 });
    this.deps.onChanged?.();
  }

  /** Rename and move are the same operation now: a path edit. */
  move(fromRelative: string, toRelative: string): MoveResult {
    const from = this.resolveVisible(fromRelative);
    const to = this.resolveVisible(toRelative);
    if (!existsSync(from)) return 'not-found';
    if (existsSync(to)) return 'target-exists';
    mkdirSync(dirname(to), { recursive: true, mode: 0o700 });
    renameSync(from, to);
    this.deps.onChanged?.();
    return 'ok';
  }

  /** Deleting is a move into Garbage plus a note of where it came from. */
  remove(relativePath: string): 'ok' | 'not-found' {
    const cleaned = cleanRelative(relativePath);
    const from = this.resolveVisible(cleaned);
    if (!existsSync(from)) return 'not-found';

    const entryName = this.freeGarbageName(basename(cleaned));
    renameSync(from, join(this.garbageDir(), entryName));

    const notes = this.readNotes();
    notes[entryName] = {
      originalPath: cleaned,
      deletedAt: new Date(this.deps.clock.now()).toISOString(),
    };
    this.writeNotes(notes);
    this.deps.onChanged?.();
    return 'ok';
  }

  listGarbage(): GarbageEntry[] {
    const notes = this.readNotes();
    const entries: GarbageEntry[] = [];
    for (const dirent of this.safeReaddir(this.garbageDir())) {
      if (dirent.name.startsWith('.')) continue;
      const full = join(this.garbageDir(), dirent.name);
      const stat = statSync(full);
      const note: GarbageNote | undefined = notes[dirent.name];
      // No note = someone dropped it in by hand. Its own mtime carries the
      // clock and the root is the only honest place to restore it to.
      const deletedAt = note?.deletedAt ?? new Date(stat.mtimeMs).toISOString();
      entries.push({
        name: dirent.name,
        originalPath: note?.originalPath ?? dirent.name,
        kind: dirent.isDirectory() ? 'dir' : 'file',
        size: dirent.isDirectory() ? 0 : stat.size,
        deletedAt,
        purgeAt: new Date(new Date(deletedAt).getTime() + TRASH_RETENTION_MS).toISOString(),
      });
    }
    return entries.sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : -1));
  }

  restore(entryName: string): RestoreResult {
    const entry = this.listGarbage().find((candidate) => candidate.name === entryName);
    if (entry === undefined) return 'not-found';

    const target = this.resolveVisible(entry.originalPath);
    if (existsSync(target)) return 'name-taken';
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    renameSync(join(this.garbageDir(), entryName), target);

    this.dropNote(entryName);
    this.deps.onChanged?.();
    return 'ok';
  }

  purge(entryName: string): boolean {
    if (entryName.startsWith('.') || entryName.includes('/') || entryName.includes('\\')) {
      return false;
    }
    const full = join(this.garbageDir(), entryName);
    if (!existsSync(full)) return false;
    rmSync(full, { recursive: true, force: true });
    this.dropNote(entryName);
    return true;
  }

  emptyGarbage(): number {
    let purged = 0;
    for (const entry of this.listGarbage()) {
      if (this.purge(entry.name)) purged += 1;
    }
    return purged;
  }

  /** Purges entries past their thirty days; the sweeper calls this daily. */
  purgeExpired(): number {
    const now = this.deps.clock.now();
    let purged = 0;
    for (const entry of this.listGarbage()) {
      if (now > new Date(entry.purgeAt).getTime() && this.purge(entry.name)) purged += 1;
    }
    return purged;
  }

  /** The absolute path of a live entry, for streaming a download. Jailed. */
  absoluteOf(relativePath: string): string {
    return this.resolveVisible(relativePath);
  }

  /** Live entries whose path contains the query, case-insensitive, tree order. */
  searchNames(query: string, limit = 40): { path: string; kind: 'file' | 'dir' }[] {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return [];
    const hits: { path: string; kind: 'file' | 'dir' }[] = [];
    const visit = (nodes: FileNode[]): void => {
      for (const node of nodes) {
        if (hits.length >= limit) return;
        if (node.path.toLowerCase().includes(needle)) {
          hits.push({ path: node.path, kind: node.kind });
        }
        if (node.children !== undefined) visit(node.children);
      }
    };
    visit(this.tree());
    return hits;
  }

  /** Live files touched at or after `sinceMs` -- the provenance walk. */
  modifiedSince(sinceMs: number): string[] {
    const touched: string[] = [];
    const visit = (nodes: FileNode[]): void => {
      for (const node of nodes) {
        if (node.kind === 'file' && node.mtimeMs >= sinceMs) touched.push(node.path);
        if (node.children !== undefined) visit(node.children);
      }
    };
    visit(this.tree());
    return touched;
  }

  private walk(relative: string): FileNode[] {
    const dir = relative === '' ? this.deps.root : resolveInFiles(this.deps.root, relative);
    const nodes: FileNode[] = [];
    for (const dirent of this.safeReaddir(dir)) {
      if (dirent.name.startsWith('.')) continue;
      if (relative === '' && dirent.name === GARBAGE_DIR) continue;
      const path = relative === '' ? dirent.name : `${relative}/${dirent.name}`;
      const stat = statSync(join(dir, dirent.name));
      nodes.push(
        dirent.isDirectory()
          ? { name: dirent.name, path, kind: 'dir', size: 0, mtimeMs: stat.mtimeMs, children: this.walk(path) }
          : { name: dirent.name, path, kind: 'file', size: stat.size, mtimeMs: stat.mtimeMs },
      );
    }
    return nodes.sort((a, b) =>
      a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1,
    );
  }

  /** The jail plus the two visibility rules: no dotfiles, no reaching into Garbage. */
  private resolveVisible(relativePath: string): string {
    const cleaned = cleanRelative(relativePath);
    if (isHiddenPath(cleaned)) throw new Error('Hidden paths are reserved for Pop Agent.');
    if (cleaned === GARBAGE_DIR || cleaned.startsWith(`${GARBAGE_DIR}/`)) {
      throw new Error('Garbage is managed through the trash operations.');
    }
    return resolveInFiles(this.deps.root, cleaned);
  }

  private garbageDir(): string {
    return join(this.deps.root, GARBAGE_DIR);
  }

  /** `name`, then `name (2)`, `name (3)`… two deletes never collide. */
  private freeGarbageName(name: string): string {
    if (!existsSync(join(this.garbageDir(), name))) return name;
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    for (let n = 2; ; n += 1) {
      const candidate = `${stem} (${String(n)})${ext}`;
      if (!existsSync(join(this.garbageDir(), candidate))) return candidate;
    }
  }

  private readNotes(): Record<string, GarbageNote | undefined> {
    try {
      const parsed: unknown = JSON.parse(
        readFileSync(join(this.garbageDir(), GARBAGE_INFO), 'utf8'),
      );
      if (typeof parsed !== 'object' || parsed === null) return {};
      const notes: Record<string, GarbageNote> = {};
      for (const [name, value] of Object.entries(parsed)) {
        const note = value as Partial<GarbageNote> | null;
        if (
          note !== null &&
          typeof note === 'object' &&
          typeof note.originalPath === 'string' &&
          typeof note.deletedAt === 'string'
        ) {
          notes[name] = { originalPath: note.originalPath, deletedAt: note.deletedAt };
        }
      }
      return notes;
    } catch {
      // A missing or corrupt note file must never block the trash itself.
      return {};
    }
  }

  private writeNotes(notes: Record<string, GarbageNote | undefined>): void {
    writeFileSync(
      join(this.garbageDir(), GARBAGE_INFO),
      JSON.stringify(notes, null, 2),
      { mode: 0o600 },
    );
  }

  private dropNote(entryName: string): void {
    const notes = this.readNotes();
    if (notes[entryName] !== undefined) {
      delete notes[entryName];
      this.writeNotes(notes);
    }
  }

  private safeReaddir(dir: string): { name: string; isDirectory(): boolean }[] {
    try {
      return readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }
  }
}
