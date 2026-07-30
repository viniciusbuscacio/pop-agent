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
