import { randomBytes, randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { cp, lstat, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, posix, relative, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import Database from 'better-sqlite3';
import { c, t, x } from 'tar';
import { BACKUP_PASSWORD_KEY, BackupError, BackupPassword } from '../../application/backup/backup-password.js';
import { SqliteSecretsRepo } from '../db/sqlite-secrets-repo.js';
import type { SecretsRepo } from '../../application/ports/secrets-repo.js';
import type { BackupInfo, BackupOperation, BackupService } from '../../application/ports/backup-service.js';
import { prepareBrowserRestore, readRestoreStatus } from './browser-restore.js';
import { decryptArchive, encryptArchive } from './archive-crypto.js';

const KEEP = 10;
const DATABASE_FILE = 'pop-agent.db';
const EXCLUDED = new Set(['secret.key', 'models', 'voice-models', DATABASE_FILE, `${DATABASE_FILE}-wal`, `${DATABASE_FILE}-shm`]);

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
      return [{ name, size: info.size, createdAt: info.mtime.toISOString(), encrypted: name.endsWith('.popbackup') }];
    }).sort((left, right) => right.name.localeCompare(left.name));
  }

  async create(): Promise<BackupInfo> {
    if (this.busy) throw new BackupError('A backup is already running.');
    if (this.deps.secrets === undefined) throw new BackupError('Set a backup password in Settings → Backup first.');
    const password = new BackupPassword(this.deps.secrets).read();
    this.busy = true;
    this.operation = { state: 'creating' };
    let stagingRoot: string | undefined;
    try {
      const stamp = this.deps.now().replace(/[:.]/g, '-');
      const name = `pop-backup-${stamp}-${randomUUID()}.popbackup`;
      const target = join(this.deps.backupsDir, name);
      stagingRoot = await mkdtemp(join(this.deps.backupsDir, '.staging-'));
      const stagedData = join(stagingRoot, 'data');
      await cp(this.deps.dataDir, stagedData, {
        recursive: true,
        verbatimSymlinks: true,
        filter: (source) => {
          if (source === this.deps.dataDir) return true;
          const rootName = relative(this.deps.dataDir, source).split(/[\\/]/, 1)[0] ?? '';
          return !EXCLUDED.has(rootName);
        },
      });
      await snapshotDatabase(join(this.deps.dataDir, DATABASE_FILE), join(stagedData, DATABASE_FILE));
      const pending = join(stagingRoot, 'archive');
      // tar's stream respects backpressure; no unencrypted tar.gz is written.
      await encryptArchive(() => c({ gzip: true, cwd: stagedData, portable: true }, ['.']) as unknown as Readable, pending, password);
      await rename(pending, target);
      this.prune();
      return { name, size: (await stat(target)).size, createdAt: this.deps.now(), encrypted: true };
    } finally {
      try { if (stagingRoot !== undefined) await rm(stagingRoot, { recursive: true, force: true }); }
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
