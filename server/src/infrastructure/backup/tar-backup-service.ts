import { randomBytes, randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { cp, link, lstat, mkdir, mkdtemp, readdir, readFile, readlink, realpath, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, posix, relative, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { BackupImportError, MAX_BACKUP_IMPORT_BYTES } from '../../application/backup/backup-import.js';
import Database from 'better-sqlite3';
import { c, t, x } from 'tar';
import { BACKUP_PASSWORD_KEY, BackupError, BackupPassword } from '../../application/backup/backup-password.js';
import { SqliteSecretsRepo } from '../db/sqlite-secrets-repo.js';
import type { SecretsRepo } from '../../application/ports/secrets-repo.js';
import type { BackupInfo, BackupOperation, BackupService } from '../../application/ports/backup-service.js';
import { prepareBrowserRestore, readRestoreStatus } from './browser-restore.js';
import { BACKUP_CONTENT_FILE, backupIncludesFiles } from './backup-content.js';
import { decryptArchive, encryptArchive } from './archive-crypto.js';

const KEEP = 10;
const DATABASE_FILE = 'pop-agent.db';
const EXCLUDED = new Set(['.pop-backup-omitted-links.json', BACKUP_CONTENT_FILE, 'secret.key', 'models', 'voice-models', DATABASE_FILE, `${DATABASE_FILE}-wal`, `${DATABASE_FILE}-shm`]);

export interface TarBackupDeps {
  dataDir: string;
  backupsDir: string;
  now: () => string;
  /** Offline restore always takes the archive password; it needs no SecretsRepo. */
  secrets?: SecretsRepo;
  restartForRestore?: () => void;
}

export class TarBackupService implements BackupService {
  private busy = false;
  private operation: BackupOperation;

  status(): BackupOperation { return { ...this.operation }; }
  canRestore(): boolean { return this.deps.restartForRestore !== undefined; }

  requestRestore(name: string, password?: string): void {
    if (this.busy) throw new BackupError('A backup operation is already running.');
    if (!this.canRestore()) throw new BackupError('Browser restore requires the installed systemd service.');
    if (this.pathOf(name) === undefined) throw new BackupError('No such backup.');
    if (name.endsWith('.popbackup') && !password) throw new BackupError('Enter the password used to create this backup.');
    this.busy = true;
    this.operation = { state: 'preparing' };
    void prepareBrowserRestore(this.deps.dataDir, async (destination) => {
      const offline = new TarBackupService({ ...this.deps, dataDir: destination });
      if (!await offline.restore(name, password)) throw new BackupError('No such backup.');
    }).then(() => {
      this.operation = { state: 'restarting' };
      this.deps.restartForRestore?.();
    }).catch((error: unknown) => {
      this.busy = false;
      this.operation = { state: 'failed', message: error instanceof BackupError ? error.message : 'Could not prepare restore. Check available disk space and try again.' };
    });
  }
  constructor(private readonly deps: TarBackupDeps) {
    this.operation = readRestoreStatus(deps.dataDir);
    const rel = relative(resolve(deps.dataDir), resolve(deps.backupsDir));
    if (rel === '' || (rel !== '..' && !rel.startsWith('../'))) {
      throw new BackupError('Backups must be outside the data directory.');
    }
    mkdirSync(deps.backupsDir, { recursive: true, mode: 0o700 });
  }

  passwordConfigured(): boolean {
    return this.deps.secrets !== undefined && new BackupPassword(this.deps.secrets).configured();
  }

  setPassword(password: string): void {
    if (this.busy) throw new BackupError('A backup is already running.');
    if (this.deps.secrets === undefined) throw new BackupError('Backup password storage is unavailable.');
    new BackupPassword(this.deps.secrets).save(password);
  }

  list(): BackupInfo[] {
    return readdirSync(this.deps.backupsDir).flatMap((name) => {
      const path = this.pathOf(name);
      if (path === undefined) return [];
      const info = lstatSync(path);
      return [{ name, size: info.size, createdAt: info.mtime.toISOString(), encrypted: name.endsWith('.popbackup'), includeFiles: name.startsWith('pop-backup-import-') ? null : !name.endsWith('-without-files.popbackup') }];
    }).sort((left, right) => right.name.localeCompare(left.name));
  }

  async create(options: { includeFiles?: boolean; skipUnsupportedLinks?: boolean } = {}): Promise<BackupInfo> {
    const includeFiles = options.includeFiles !== false;
    if (this.busy) throw new BackupError('A backup is already running.');
    if (this.deps.secrets === undefined) throw new BackupError('Set a backup password in Settings → Backup first.');
    const password = new BackupPassword(this.deps.secrets).read();
    this.busy = true;
    this.operation = { state: 'creating' };
    let stagingRoot: string | undefined;
    try {
      const stamp = this.deps.now().replace(/[:.]/g, '-');
      const name = `pop-backup-${stamp}-${randomUUID()}${includeFiles ? '' : '-without-files'}.popbackup`;
      const target = join(this.deps.backupsDir, name);
      stagingRoot = await mkdtemp(join(this.deps.backupsDir, '.staging-'));
      const stagedData = join(stagingRoot, 'data');
      await cp(this.deps.dataDir, stagedData, {
        recursive: true,
        verbatimSymlinks: true,
        filter: (source) => {
          if (source === this.deps.dataDir) return true;
          const rootName = relative(this.deps.dataDir, source).split(/[\\/]/, 1)[0] ?? '';
          return !EXCLUDED.has(rootName) && (includeFiles || rootName !== 'files');
        },
      });
      await writeFile(join(stagedData, BACKUP_CONTENT_FILE), JSON.stringify({ version: 1, includeFiles }), { mode: 0o600 });
      await snapshotDatabase(join(this.deps.dataDir, DATABASE_FILE), join(stagedData, DATABASE_FILE));
      const omittedLinks = await normalizeBackupLinks(stagedData, this.deps.dataDir, options.skipUnsupportedLinks === true);
      if (omittedLinks.length > 0) {
        await writeFile(join(stagedData, '.pop-backup-omitted-links.json'), JSON.stringify({ version: 1, paths: omittedLinks }), { mode: 0o600 });
      }
      const pending = join(stagingRoot, 'archive');
      // tar's stream respects backpressure; no unencrypted tar.gz is written.
      await encryptArchive(() => c({ gzip: true, cwd: stagedData, portable: true }, ['.']) as unknown as Readable, pending, password);
      await rename(pending, target);
      this.prune();
      return { name, size: (await stat(target)).size, createdAt: this.deps.now(), encrypted: true, includeFiles };
    } catch (error) {
      this.operation = { state: 'failed', message: error instanceof BackupError ? error.message : 'Could not create backup. Check available disk space and try again.' };
      throw error;
    } finally {
      try { if (stagingRoot !== undefined) await rm(stagingRoot, { recursive: true, force: true }); }
      finally { this.busy = false; if (this.operation.state === 'creating') this.operation = { state: 'idle' }; }
    }
  }

  /** Raw encrypted bytes only; no parsing, decryption, retention or live-data writes. */
  async importArchive(source: AsyncIterable<Uint8Array>, signal: AbortSignal): Promise<BackupInfo> {
    if (this.busy) throw new BackupError('A backup operation is already running.');
    this.busy = true;
    this.operation = { state: 'importing' };
    let staging: string | undefined;
    try {
      signal.throwIfAborted();
      staging = await mkdtemp(join(this.deps.backupsDir, '.import-'));
      const pending = join(staging, 'archive');
      let size = 0;
      let header = Buffer.alloc(0);
      const bound = new Transform({ transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length;
        if (size > MAX_BACKUP_IMPORT_BYTES) return callback(new BackupImportError('Backup exceeds the 10 GiB import limit.', 413));
        if (header.length < 8) {
          header = Buffer.concat([header, chunk.subarray(0, 8 - header.length)]);
          if (header.length === 8 && !header.equals(Buffer.from('POPBAK01'))) {
            return callback(new BackupImportError('Not a supported .popbackup archive.', 400));
          }
        }
        callback(null, chunk);
      } });
      await pipeline(Readable.from(source), bound, createWriteStream(pending, { flags: 'wx', mode: 0o600 }), { signal });
      if (size <= 52) throw new BackupImportError('The backup header or payload is incomplete.', 400);
      signal.throwIfAborted();
      const name = `pop-backup-import-${randomUUID()}.popbackup`;
      // Same filesystem: atomic publication without rename's overwrite semantics.
      await link(pending, join(this.deps.backupsDir, name));
      return { name, size, createdAt: this.deps.now(), encrypted: true, includeFiles: null };
    } finally {
      try { if (staging !== undefined) await rm(staging, { recursive: true, force: true }); }
      finally { this.busy = false; this.operation = { state: 'idle' }; }
    }
  }

  pathOf(name: string): string | undefined {
    if (basename(name) !== name || !/^pop-backup-[a-zA-Z0-9.-]+\.(?:tar\.gz|popbackup)$/.test(name) || name.includes('..')) return undefined;
    const path = join(this.deps.backupsDir, name);
    try { return lstatSync(path).isFile() ? path : undefined; } catch { return undefined; }
  }

  async restore(name: string, password?: string): Promise<boolean> {
    const path = this.pathOf(name);
    if (path === undefined) return false;
    if (name.endsWith('.popbackup') && password === undefined) throw new BackupError('Enter the password used to create this backup.');
    const staging = await mkdtemp(join(dirname(this.deps.dataDir), '.pop-restore-'));
    const extracted = join(staging, 'data');
    try {
      let archive = path;
      if (name.endsWith('.popbackup')) {
        archive = join(staging, 'verified.tar.gz');
        await decryptArchive(path, archive, password ?? '');
      }
      await validateArchive(archive);
      await mkdir(extracted, { mode: 0o700 });
      await x({ file: archive, cwd: extracted, strict: true, preservePaths: false, noChmod: true });
      if (!(await lstat(join(extracted, DATABASE_FILE))).isFile()) throw new BackupError('Backup has no regular database file.');
      const database = new Database(join(extracted, DATABASE_FILE), { readonly: true, fileMustExist: true });
      try {
        if (database.pragma('quick_check', { simple: true }) !== 'ok') throw new BackupError('Backup database is damaged.');
      } finally { database.close(); }
      if (!backupIncludesFiles(extracted) && await lstat(join(extracted, 'files')).then(() => true, () => false)) {
        throw new BackupError('Backup content does not match its file policy.');
      }
      const hostKey = await prepareRestoredSecrets(extracted, this.deps.dataDir, password);
      // Authentication and archive validation finish before touching live data.
      // Preserve the legacy overlay semantics and this host's excluded secret.key.
      await rm(join(this.deps.dataDir, `${DATABASE_FILE}-wal`), { force: true });
      await rm(join(this.deps.dataDir, `${DATABASE_FILE}-shm`), { force: true });
      await cp(extracted, this.deps.dataDir, { recursive: true, verbatimSymlinks: true });
      if (hostKey !== undefined) await writeFile(join(this.deps.dataDir, 'secret.key'), hostKey, { flag: 'wx', mode: 0o600 });
      return true;
    } finally { await rm(staging, { recursive: true, force: true }); }
  }

  delete(name: string): boolean {
    if (this.busy) throw new BackupError('A backup operation is already running.');
    const path = this.pathOf(name);
    if (path === undefined) return false;
    rmSync(path);
    return true;
  }

  private prune(): void {
    for (const backup of this.list().slice(KEEP)) {
      const path = this.pathOf(backup.name);
      if (path !== undefined) rmSync(path);
    }
  }
}

async function validateArchive(file: string): Promise<void> {
  let invalid = false;
  const names = new Set<string>();
  await t({ file, strict: true, onReadEntry: (entry) => {
    const path = entry.path.replace(/^\.\//, '').replace(/\/$/, '');
    if (path === '' || path === '.') return;
    const normalized = posix.normalize(path);
    if (path.includes('\\') || path.startsWith('/') || normalized.startsWith('../') || normalized !== path || names.has(path)) invalid = true;
    names.add(path);
    if (['secret.key', `${DATABASE_FILE}-wal`, `${DATABASE_FILE}-shm`].includes(path)) invalid = true;
    if (!['File', 'Directory', 'SymbolicLink', 'Link'].includes(entry.type)) invalid = true;
    if (entry.type === 'SymbolicLink' || entry.type === 'Link') {
      const target = entry.linkpath ?? '';
      if (target === '') invalid = true;
      const resolved = posix.normalize(posix.join(entry.type === 'Link' ? '.' : posix.dirname(path), target));
      if (target.startsWith('/') || target.includes('\\') || resolved === '..' || resolved.startsWith('../') || resolved === 'secret.key') invalid = true;
    }
  } });
  if (invalid) throw new BackupError('Backup contains unsafe or unsupported archive entries.');
}

/** A new host can recover content without the old host key, but must reconnect SecretsRepo credentials. */
async function prepareRestoredSecrets(extracted: string, dataDir: string, password?: string): Promise<Buffer | undefined> {
  const database = new Database(join(extracted, DATABASE_FILE), { fileMustExist: true });
  try {
    if (database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'secrets'").get() === undefined) return undefined;
    let key: Buffer;
    let newKey = false;
    try { key = await readFile(join(dataDir, 'secret.key')); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      key = randomBytes(32);
      newKey = true;
    }
    if (key.length !== 32) throw new BackupError('The destination host key is invalid.');
    const secrets = new SqliteSecretsRepo(database, key);
    let compatible = !newKey;
    try {
      for (const row of database.prepare('SELECT key FROM secrets').all() as { key: string }[]) secrets.get(row.key);
    } catch { compatible = false; }
    database.transaction(() => {
      if (!compatible) {
        database.exec('DELETE FROM secrets');
        secrets.set('session_hmac_secret', randomBytes(32).toString('base64'));
      }
      // Explicit restore password remains reusable even after moving to a new host.
      if (password !== undefined) secrets.set(BACKUP_PASSWORD_KEY, password);
    })();
    return newKey ? key : undefined;
  } finally { database.close(); }
}

async function snapshotDatabase(source: string, destination: string): Promise<void> {
  const database = new Database(source, { readonly: true, fileMustExist: true });
  try { await database.backup(destination); } finally { database.close(); }
}

/** Never dereference links while copying. Normalize only targets present in the snapshot. */
async function normalizeBackupLinks(staged: string, source: string, skipUnsupported: boolean): Promise<string[]> {
  const omitted: string[] = [];
  const sourceRoot = await realpath(source);
  const inside = (path: string): boolean => path !== '..' && !path.startsWith('../') && !isAbsolute(path);
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) { await walk(path); continue; }
      if (!entry.isSymbolicLink()) continue;
      const name = relative(staged, path);
      try {
        const original = await readlink(path);
        // Relative links with lexical escapes remain invalid even if an outside alias points back in.
        if (!isAbsolute(original) && !inside(relative(staged, resolve(dirname(path), original)))) throw new Error('escape');
        const target = await realpath(resolve(dirname(join(sourceRoot, name)), original));
        const targetName = relative(sourceRoot, target);
        if (!inside(targetName)) throw new Error('external');
        const stagedTarget = join(staged, targetName);
        // Canonical targets cannot be excluded, dangling or links into live data.
        const targetInfo = await lstat(stagedTarget);
        if (!targetInfo.isFile() && !targetInfo.isDirectory()) throw new Error('missing target');
        if (!inside(relative(staged, await realpath(stagedTarget)))) throw new Error('escape');
        const replacement = relative(dirname(path), stagedTarget) || '.';
        if (replacement.includes('\\')) throw new Error('unsupported');
        await rm(path);
        await symlink(replacement, path);
      } catch {
        if (skipUnsupported) { await rm(path); omitted.push(name); continue; }
        throw new BackupError(`Cannot back up symbolic link "${name}": its target must exist inside included backup data. Remove or relocate the link and retry; nothing was excluded silently.`);
      }
    }
  }
  await walk(staged);
  return omitted;
}
