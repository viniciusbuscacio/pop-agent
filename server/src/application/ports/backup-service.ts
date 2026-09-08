/**
 * Snapshots of the data directory (docs/specs/Spec-Pop-General.md §16). A backup is a single
 * encrypted archive of POP_AGENT_DATA_DIR except the host secret key.
 * Legacy tar.gz archives remain readable. Restore is an offline operation.
 */

export interface BackupInfo {
  /** The file name, which is also the id. */
  name: string;
  /** Bytes on disk. */
  size: number;
  createdAt: string;
  encrypted?: boolean;
}

export interface BackupOperation {
  state: 'idle' | 'creating' | 'preparing' | 'restarting' | 'restored' | 'failed';
  message?: string;
}

export interface BackupService {
  status?(): BackupOperation;
  canRestore?(): boolean;
  requestRestore?(name: string, password?: string): void;
  passwordConfigured(): boolean;
  setPassword(password: string): void;
  list(): BackupInfo[];
  create(): Promise<BackupInfo>;
  /** Absolute path of a backup, for the download route. Undefined if unknown. */
  pathOf(name: string): string | undefined;
  /** Replaces the live data with a backup's contents. Returns false if unknown. */
  restore(name: string, password?: string): Promise<boolean>;
  delete(name: string): boolean;
}
