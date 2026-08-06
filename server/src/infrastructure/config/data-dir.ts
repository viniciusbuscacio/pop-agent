import { lstatSync, mkdirSync, readlinkSync, symlinkSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Runtime data lives in one directory (popy.spec §4) so a backup is a folder
 * copy. Default ~/.popy, overridable with POPY_DATA_DIR (tests point it at a
 * temp dir).
 */
export function resolveDataDir(): string {
  const fromEnv = process.env['POPY_DATA_DIR'];
  return fromEnv !== undefined && fromEnv.length > 0 ? fromEnv : join(homedir(), '.popy');
}

/** Creates the directory if needed and returns it. Owner-only: it holds keys. */
export function ensureDataDir(dataDir: string): string {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  return dataDir;
}

/**
 * The single root the agent works in (popy.spec §4). Kept apart from the data
 * directory on purpose: this one is meant to be looked at, edited and cloned
 * into, and it holds no keys.
 */
export function resolveWorkspace(): string {
  const fromEnv = process.env['POPY_WORKSPACE'];
  return fromEnv !== undefined && fromEnv.length > 0
    ? fromEnv
    : join(homedir(), 'popy-workspace');
}

export function ensureWorkspace(workspace: string): string {
  mkdirSync(workspace, { recursive: true });
  return workspace;
}

/**
 * The user's Files (popy.spec §14 "Files as a plain folder"): a plain
 * directory tree with real names, inside the data directory so it rides the
 * backup. What `tree` shows here is exactly what the Files tab shows.
 */
export function resolveFilesDir(dataDir: string): string {
  return join(dataDir, 'files');
}

export function ensureFilesDir(dataDir: string): string {
  const dir = resolveFilesDir(dataDir);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/**
 * Places the user's Files inside the agent's workspace as `Files/` (§14): a
 * symlink, so the tab and the agent read the same bytes and can never
 * disagree. Returns a warning instead of acting when something that is not
 * this link already sits there -- replacing what the user put in their own
 * workspace is not this function's call.
 */
export function ensureWorkspaceFilesLink(workspace: string, filesDir: string): string | undefined {
  const link = join(workspace, 'Files');
  try {
    const stat = lstatSync(link);
    if (!stat.isSymbolicLink()) {
      return 'the workspace already has a non-link "Files" entry; leaving it alone';
    }
    if (readlinkSync(link) === filesDir) return undefined;
    unlinkSync(link);
  } catch {
    // Nothing there yet -- the normal first boot.
  }
  symlinkSync(filesDir, link, 'dir');
  return undefined;
}

/**
 * Where artifact bytes live (popy.spec §6, §14): inside the data directory so
 * they ride the backup (they are the user's own content), grouped per chat.
 */
export function resolveArtifactsDir(dataDir: string): string {
  return join(dataDir, 'artifacts');
}

export function ensureArtifactsDir(dataDir: string): string {
  const dir = resolveArtifactsDir(dataDir);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}
