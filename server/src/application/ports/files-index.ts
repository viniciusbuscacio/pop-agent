import type { FileNode } from '../files/files-service.js';

/** Disposable metadata projection. Files and their on-demand jail remain authority. */
export interface FilesIndex {
  tree(): FileNode[];
  available(): boolean;
  changed(paths: string[]): void;
  subscribe(listener: () => void): () => void;
}
