import { mkdirSync } from 'node:fs';
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
