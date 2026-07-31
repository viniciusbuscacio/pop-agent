/**
 * The single living document the agent keeps about the user (popy.spec §7).
 * One row, with a one-level backup so a bad edit can be rolled back.
 */
export interface UserMemory {
  doc: string;
  backup: string;
  lastCondensedAt: string;
}

export interface UserMemoryRepo {
  read(): UserMemory;
  /** Writes the doc, keeping the previous version as the backup. */
  write(doc: string): void;
  /** Restores the backup as the current doc (and vice versa). */
  restoreBackup(): void;
  /** Records that a condensation just ran, so it happens at most daily. */
  markCondensed(at: string): void;
}
