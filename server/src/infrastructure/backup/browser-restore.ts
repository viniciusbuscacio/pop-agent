import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { BackupOperation } from '../../application/ports/backup-service.js';
import { BackupError } from '../../application/backup/backup-password.js';

const pendingPath = (dataDir: string): string => `${resolve(dataDir)}.restore-pending`;
const statusPath = (dataDir: string): string => `${resolve(dataDir)}.restore-status.json`;

export function readRestoreStatus(dataDir: string): BackupOperation {
  try {
    const value = JSON.parse(readFileSync(statusPath(dataDir), 'utf8')) as BackupOperation;
    if (value.state === 'restored' || value.state === 'failed') return value;
  } catch { /* No restore has completed on this host. */ }
  return { state: 'idle' };
}

/** Validate into a private sibling directory. Live repositories remain untouched. */
export async function prepareBrowserRestore(dataDir: string, extract: (destination: string) => Promise<void>): Promise<void> {
  if (!(await lstat(dataDir)).isDirectory() || (await lstat(dataDir)).isSymbolicLink()) {
    throw new BackupError('Browser restore requires a regular data directory. Use popman restore instead.');
  }
  const pending = pendingPath(dataDir);
  // Exclusive creation also rejects another process preparing the same data root.
  try { await mkdir(pending, { mode: 0o700 }); }
  catch { throw new BackupError('A restore is already pending. Restart the server before trying again.'); }
  try {
    const destination = join(pending, 'data');
    await mkdir(destination, { mode: 0o700 });
    // Keep this host's signing/encryption key, never an archive-supplied key.
    await copyFile(join(dataDir, 'secret.key'), join(destination, 'secret.key'));
    await extract(destination);
    // Published last: a crash during extraction never installs partial data.
    await writeFile(join(pending, 'ready'), 'ready', { mode: 0o600, flag: 'wx' });
  } catch (error) {
    await rm(pending, { recursive: true, force: true });
    throw error;
  }
}

/** Called before bootstrap opens SQLite, starts jobs or accepts HTTP traffic. */
export async function applyPendingRestore(dataDir: string): Promise<void> {
  const pending = pendingPath(dataDir);
  if (!existsSync(pending)) return;
  if (!(await lstat(pending)).isDirectory() || (await lstat(pending)).isSymbolicLink()) {
    throw new BackupError('Invalid pending restore directory.');
  }
  const staged = join(pending, 'data');
  const original = join(pending, 'original');
  if (!existsSync(join(pending, 'ready'))) {
    // Interrupted preparation; the original data has never moved.
    if (existsSync(original)) throw new BackupError('Incomplete restore journal requires operator recovery.');
    await rm(pending, { recursive: true, force: true });
    await writeFile(statusPath(dataDir), JSON.stringify({ state: 'failed', message: 'Restore preparation was interrupted. Current data was kept.' }), { mode: 0o600 });
    return;
  }
  if (await readFile(join(pending, 'ready'), 'utf8') !== 'ready') throw new BackupError('Invalid restore journal.');
  try {
    // Resumable rename sequence: a restart between either rename is safe.
    if (!existsSync(original)) await rename(dataDir, original);
    if (!existsSync(dataDir)) await rename(staged, dataDir);
  } catch {
    if (!existsSync(dataDir) && existsSync(original)) await rename(original, dataDir);
    // Disarm the failed operation before starting the unchanged data.
    await rm(join(pending, 'ready'), { force: true });
    await rm(pending, { recursive: true, force: true });
    await writeFile(statusPath(dataDir), JSON.stringify({ state: 'failed', message: 'Restore could not be applied. Previous data was kept.' }), { mode: 0o600 });
    return;
  }
  // Downloadable caches are excluded from new archives. Reuse this host's
  // verified downloads when present; on a new host they download on demand.
  for (const cache of ['models', 'voice-models']) {
    if (!existsSync(join(dataDir, cache)) && existsSync(join(original, cache))) {
      try { await rename(join(original, cache), join(dataDir, cache)); }
      catch { /* Cache reuse is optional; owner data is already installed. */ }
    }
  }
  // Retain the previous user-data directory for operator recovery, outside backups.
  const recovery = `${resolve(dataDir)}.before-restore-${randomUUID()}`;
  await rename(pending, recovery);
  await writeFile(statusPath(dataDir), JSON.stringify({ state: 'restored', message: 'Backup restored. Previous data was retained on the server for recovery.' }), { mode: 0o600 });
}
