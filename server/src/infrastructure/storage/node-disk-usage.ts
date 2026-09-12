import { readdirSync, statSync, statfsSync } from 'node:fs';
import { join } from 'node:path';
import type {
  DirectorySize,
  DiskUsage,
  FilesystemSpace,
} from '../../application/ports/disk-usage.js';

/**
 * Measuring directories with the real filesystem (docs/specs/Spec-Pop-General.md §14).
 *
 * Everything here answers instead of throwing. This report is read on a
 * Settings screen, and a directory that does not exist yet -- no backup ever
 * taken, no voice model downloaded -- is a normal state of the install, worth
 * a zero and not an error page.
 *
 * Symlinks are counted as nothing. Following them would let one directory be
 * measured twice, or walk forever around a loop; the data directory does not
 * use them, so the safe answer costs nothing.
 */
export class NodeDiskUsage implements DiskUsage {
  directoryBytes(dir: string): DirectorySize {
    let bytes = 0;
    let files = 0;
    const pending = [dir];

    while (pending.length > 0) {
      const current = pending.pop() as string;
      let entries;
      try {
        entries = readdirSync(current, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        const path = join(current, entry.name);
        if (entry.isDirectory()) {
          pending.push(path);
          continue;
        }
        try {
          bytes += statSync(path).size;
          files += 1;
        } catch {
          // Deleted between the listing and the stat: it is gone, so it is 0.
        }
      }
    }

    return { bytes, files };
  }

  fileBytes(...paths: string[]): number {
    let bytes = 0;
    for (const path of paths) {
      try {
        bytes += statSync(path).size;
      } catch {
        // A missing WAL or shm just means the database is idle.
      }
    }
    return bytes;
  }

  space(dir: string): FilesystemSpace | undefined {
    try {
      const stats = statfsSync(dir);
      // bavail, not bfree: the blocks reserved for root are not space anyone
      // here can use, and promising them would overstate the headroom.
      return {
        freeBytes: Number(stats.bavail) * Number(stats.bsize),
        totalBytes: Number(stats.blocks) * Number(stats.bsize),
      };
    } catch {
      return undefined;
    }
  }
}
