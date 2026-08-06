import { realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize, sep } from 'node:path';

/**
 * Path safety for the Files folder (popy.spec §14, "Files as a plain folder").
 *
 * Files are addressed by real relative paths now, so the path itself is user
 * input everywhere -- the download URL, the upload form, the agent's tools.
 * One resolver, used by all of them, refuses everything that could reach
 * outside the tree: lexically first (catches `..` and absolutes), then by real
 * path so a symlink pointing out of the root is followed and then refused.
 */

/** Refuses escape attempts and returns the absolute path inside the root. */
export function resolveInFiles(root: string, relativePath: string): string {
  const cleaned = cleanRelative(relativePath);

  const realRoot = realpathSync(root);
  const withSep = realRoot.endsWith(sep) ? realRoot : realRoot + sep;
  const target = normalize(join(realRoot, cleaned));
  if (target !== realRoot && !target.startsWith(withSep)) {
    throw new Error('The path must stay inside Files.');
  }

  // The file itself may not exist yet (a write creates it), but every existing
  // ancestor must resolve back into the root -- otherwise a symlinked folder
  // would carry the write outside.
  const anchor = firstExistingAncestor(target, realRoot);
  if (anchor !== realRoot && !anchor.startsWith(withSep)) {
    throw new Error('The path must stay inside Files.');
  }

  return target;
}

/** Normalizes separators and rejects the shapes that are never a Files path. */
export function cleanRelative(relativePath: string): string {
  const cleaned = relativePath.trim().replace(/\\/g, '/').replace(/\/+$/, '');
  if (cleaned.length === 0) throw new Error('A file path is required.');
  if (cleaned.includes('\0')) throw new Error('The path cannot contain a null byte.');
  if (isAbsolute(cleaned) || cleaned.startsWith('/')) {
    throw new Error('The path must be relative to Files.');
  }
  const segments = cleaned.split('/');
  if (segments.some((s) => s === '..' || s === '.')) {
    throw new Error('The path cannot contain . or .. segments.');
  }
  return segments.join('/');
}

/**
 * True when any segment is hidden (starts with a dot). Dotfiles are reserved
 * for Popy's own metadata (`.garbage.json`) and never listed, written or
 * served -- the tab shows exactly what a `tree` would.
 */
export function isHiddenPath(relativePath: string): boolean {
  return relativePath.split('/').some((segment) => segment.startsWith('.'));
}

function firstExistingAncestor(target: string, stopAt: string): string {
  let current = target;
  while (current !== stopAt && current.length > stopAt.length) {
    try {
      return realpathSync(current);
    } catch {
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return stopAt;
}
