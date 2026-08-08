/**
 * Snapshots of the data directory (pop-agent.spec §16). A backup is a single
 * tar.gz of everything under POP_AGENT_DATA_DIR except the secret key file -- so a
 * leaked backup leaks no keys, and restoring on a new machine means re-entering
 * the provider key. Restore replaces the live data and needs a restart to take.
 */

export interface BackupInfo {
  /** The file name, which is also the id. */
  name: string;
  /** Bytes on disk. */
  size: number;
  createdAt: string;
}

export interface BackupService {
  list(): BackupInfo[];
  create(): BackupInfo;
  /** Absolute path of a backup, for the download route. Undefined if unknown. */
  pathOf(name: string): string | undefined;
  /** Replaces the live data with a backup's contents. Returns false if unknown. */
  restore(name: string): boolean;
  delete(name: string): boolean;
}
