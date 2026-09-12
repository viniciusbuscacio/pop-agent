/**
 * Measuring the filesystem, kept behind a port so the storage report can be
 * tested without a disk (docs/specs/Spec-Pop-General.md §14).
 *
 * Every method answers rather than throws: a directory that does not exist yet
 * (no backups taken, no voice models downloaded) is zero bytes, not an error.
 * A report that fails because one folder is missing is a report nobody sees.
 */

export interface DirectorySize {
  bytes: number;
  files: number;
}

export interface FilesystemSpace {
  freeBytes: number;
  totalBytes: number;
}

export interface DiskUsage {
  /** Total size of every file under `dir`, recursively. Missing dir = zero. */
  directoryBytes(dir: string): DirectorySize;
  /** Size of one file, plus any siblings it names. Missing file = zero. */
  fileBytes(...paths: string[]): number;
  /** Free and total space of the filesystem holding `dir`, when reported. */
  space(dir: string): FilesystemSpace | undefined;
}
