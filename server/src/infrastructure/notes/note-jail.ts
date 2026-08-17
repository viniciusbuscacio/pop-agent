import { realpathSync } from 'node:fs';
import { isAbsolute, join, normalize, resolve, sep } from 'node:path';

/**
 * The notes vault's guard rail (docs/specs/Spec-Pop-General.md §11, aw's jail ported). Every path a
 * tool is handed is resolved against the vault root and rejected if it lands
 * outside it -- so a note called `../../secret.key` reads nothing, and a
 * symlink pointing out of the vault is followed and then refused.
 *
 * Only markdown, never a dotfile: the vault is for notes, not for hiding a
 * `.env` next to them.
 */

export class NoteJailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoteJailError';
  }
}

export class NoteJail {
  /** The vault root, already real-pathed so symlink checks compare like for like. */
  private readonly root: string;

  constructor(root: string) {
    this.root = realpathSync(root);
  }

  /**
   * Turns a vault-relative path into an absolute one inside the vault, or
   * throws. The path is validated lexically first (cheap, catches `..` and
   * absolutes), then the real path of whatever exists is checked against the
   * root (catches a symlink escaping the vault).
   */
  resolve(relativePath: string): string {
    const cleaned = relativePath.trim().replace(/\\/g, '/');
    if (cleaned.length === 0) throw new NoteJailError('A note path is required.');
    if (isAbsolute(cleaned) || cleaned.startsWith('/')) {
      throw new NoteJailError('A note path must be relative to the vault.');
    }
    if (cleaned.includes('\0')) throw new NoteJailError('A note path cannot contain a null byte.');
    if (!cleaned.endsWith('.md')) throw new NoteJailError('Only .md files live in the vault.');
    if (cleaned.split('/').some((part) => part.startsWith('.'))) {
      throw new NoteJailError('A note path cannot contain dot segments or dotfiles.');
    }

    const target = normalize(join(this.root, cleaned));
    if (target !== this.root && !target.startsWith(this.root + sep)) {
      throw new NoteJailError('That note path escapes the vault.');
    }

    // If the path (or a parent) exists as a symlink out of the vault, the real
    // path exposes it. A path that does not exist yet is fine -- it is a write.
    const real = realOfNearest(target);
    if (real !== undefined && real !== this.root && !real.startsWith(this.root + sep)) {
      throw new NoteJailError('That note path resolves outside the vault.');
    }

    return target;
  }

  get rootPath(): string {
    return this.root;
  }
}

/** The real path of the target, or of the deepest ancestor that exists. */
function realOfNearest(target: string): string | undefined {
  let current = target;
  for (;;) {
    try {
      return realpathSync(current);
    } catch {
      const parent = resolve(current, '..');
      if (parent === current) return undefined;
      current = parent;
    }
  }
}
