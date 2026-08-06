import { entityId } from '../../domain/ids.js';
import type { Clock } from '../ports/clock.js';
import type { FileProvenanceRepo } from '../ports/file-provenance-repo.js';
import type { FilesService } from './files-service.js';

/**
 * Writes the provenance log (popy.spec §14). Two sources feed it:
 *
 * - An upload names its chat (or none) directly -- `recordWrite`.
 * - The agent writes into `Files/` with its built-in tools, which the server
 *   never intercepts. So when a run ends, `recordRunWrites` walks the tree
 *   and logs every file touched since the run began. mtime is the witness;
 *   a duplicate entry for the same chat+path is skipped, because "this chat
 *   wrote this file" said twice is noise, not history.
 */
export class FileProvenanceService {
  constructor(
    private readonly deps: {
      repo: FileProvenanceRepo;
      files: FilesService;
      clock: Clock;
    },
  ) {}

  recordWrite(chatId: string, path: string): void {
    if (this.deps.repo.latestChatFor(path) === chatId) return;
    this.deps.repo.record({
      id: entityId('prov'),
      chatId,
      path,
      createdAt: new Date(this.deps.clock.now()).toISOString(),
    });
  }

  /** Logs every live file modified at or after `sinceMs` as written by `chatId`. */
  recordRunWrites(chatId: string, sinceMs: number): number {
    let recorded = 0;
    for (const path of this.deps.files.modifiedSince(sinceMs)) {
      if (this.deps.repo.latestChatFor(path) === chatId) continue;
      this.recordWrite(chatId, path);
      recorded += 1;
    }
    return recorded;
  }

  listByChat(chatId: string): { path: string; createdAt: string }[] {
    return this.deps.repo.listByChat(chatId);
  }
}
