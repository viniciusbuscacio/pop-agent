import { join } from 'node:path';
import type { DirectorySize, DiskUsage } from '../ports/disk-usage.js';
import type { StorageRepo } from '../ports/storage-repo.js';

/**
 * Where the disk actually went (popy.spec §14).
 *
 * This exists before any quota does, on purpose, and the first install it was
 * pointed at settled the argument: 1.7 GB of downloaded whisper weights
 * against 224 KB of actual files, most of it a model nobody had selected. A
 * limit picked without looking would have capped the wrong thing.
 *
 * Two rules keep the report honest. Nothing is counted twice: the Files
 * folder is measured once, on disk, exactly as the tab shows it. And backups
 * are shown even though they sit OUTSIDE the data
 * directory -- they are the reason the disk is full, so hiding them because
 * of where they live would defeat the point.
 */

export type StorageKey =
  | 'files'
  | 'index'
  | 'database'
  | 'models'
  | 'workspace'
  | 'other'
  | 'backups';

export interface StorageEntry {
  key: StorageKey;
  bytes: number;
  /** How many things the line counts, where counting means anything. */
  count?: number;
}

export interface StorageReport {
  /** Everything Popy is responsible for, backups included. */
  totalBytes: number;
  entries: StorageEntry[];
  /** The filesystem the data directory sits on, when the platform says. */
  disk?: { freeBytes: number; totalBytes: number };
}

export interface StorageServiceDeps {
  repo: StorageRepo;
  disk: DiskUsage;
  dataDir: string;
  /** The user's Files folder (popy.spec §14): measured as the tab shows it. */
  filesDir: string;
  workspace: string;
  backupsDir: string;
  /** Downloaded weights (voice models, embeddings), measured on their own. */
  modelDirs: string[];
}

export class StorageService {
  constructor(private readonly deps: StorageServiceDeps) {}

  report(): StorageReport {
    const { repo, disk, dataDir, filesDir, workspace, backupsDir, modelDirs } = this.deps;
    const totals = repo.totals();

    const filesOnDisk = disk.directoryBytes(filesDir);
    // The database's own three files: the WAL alone can outweigh the db after
    // a busy day, and a report that omitted it would not add up to the folder.
    const databaseBytes = disk.fileBytes(
      join(dataDir, 'popy.db'),
      join(dataDir, 'popy.db-wal'),
      join(dataDir, 'popy.db-shm'),
    );
    const workspaceSize = disk.directoryBytes(workspace);
    const backupsSize = disk.directoryBytes(backupsDir);

    // Downloaded model weights get their own line because they dominate and
    // nobody expects it: on the first install measured, whisper's models were
    // 1.7 GB against 224 KB of actual files, and a single medium model nobody
    // had selected was 1.5 GB of it. Folding that into "everything else" would
    // have made the biggest number on the disk the least legible one.
    const modelsSize = modelDirs.reduce<DirectorySize>(
      (sum, dir) => {
        const measured = disk.directoryBytes(dir);
        return { bytes: sum.bytes + measured.bytes, files: sum.files + measured.files };
      },
      { bytes: 0, files: 0 },
    );

    // Whatever is left in the data directory: notes, skills, pi's sessions,
    // the odd stray file. Never negative -- a file landing between two
    // measurements must not produce a nonsense line.
    const dataDirBytes = disk.directoryBytes(dataDir).bytes;
    const other = Math.max(
      dataDirBytes - filesOnDisk.bytes - databaseBytes - modelsSize.bytes,
      0,
    );

    const entries: StorageEntry[] = [
      { key: 'files', bytes: filesOnDisk.bytes, count: filesOnDisk.files },
      { key: 'index', bytes: totals.index.bytes, count: totals.index.count },
      { key: 'database', bytes: databaseBytes },
      { key: 'models', bytes: modelsSize.bytes, count: modelsSize.files },
      { key: 'workspace', bytes: workspaceSize.bytes, count: workspaceSize.files },
      { key: 'other', bytes: other },
      { key: 'backups', bytes: backupsSize.bytes, count: backupsSize.files },
    ];

    // The index lives inside the database file, so adding both would count it
    // twice; the total follows the folders, and index is a slice shown for
    // information.
    const totalBytes = entries
      .filter((entry) => entry.key !== 'index')
      .reduce((sum, entry) => sum + entry.bytes, 0);

    const space = disk.space(dataDir);
    return { totalBytes, entries, ...(space === undefined ? {} : { disk: space }) };
  }
}
