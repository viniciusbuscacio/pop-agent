import { mkdtempSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FileProvenanceRepo, ProvenanceEntry } from '../ports/file-provenance-repo.js';
import { FileProvenanceService } from './file-provenance.js';
import { FilesService } from './files-service.js';

class MemoryProvenance implements FileProvenanceRepo {
  entries: ProvenanceEntry[] = [];
  record(entry: ProvenanceEntry): void {
    this.entries.push(entry);
  }
  latestChatFor(path: string): string | undefined {
    return this.entries.filter((entry) => entry.path === path).at(-1)?.chatId;
  }
  listByChat(chatId: string): { path: string; createdAt: string }[] {
    return this.entries
      .filter((entry) => entry.chatId === chatId)
      .map((entry) => ({ path: entry.path, createdAt: entry.createdAt }))
      .reverse();
  }
}

// The walk reads real filesystem mtimes, so the clock must be real time here.
const NOW = Date.now();
const clock = { now: () => NOW };

let root: string;
let files: FilesService;
let repo: MemoryProvenance;
let provenance: FileProvenanceService;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pop-prov-'));
  files = new FilesService({ root, clock });
  repo = new MemoryProvenance();
  provenance = new FileProvenanceService({ repo, files, clock });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('FileProvenanceService', () => {
  it('logs the files a run touched, and only those', () => {
    files.write('untouched.txt', Buffer.from('old'));
    const before = new Date(NOW - 60_000);
    utimesSync(join(root, 'untouched.txt'), before, before);

    files.write('reports/made-by-run.pdf', Buffer.from('new'));
    const recorded = provenance.recordRunWrites('chat-a', NOW - 1000);

    expect(recorded).toBe(1);
    expect(repo.entries.map((entry) => entry.path)).toEqual(['reports/made-by-run.pdf']);
  });

  it('says a fact once: the same chat re-touching a path adds nothing', () => {
    files.write('r.pdf', Buffer.from('one'));
    provenance.recordRunWrites('chat-a', NOW - 1000);
    provenance.recordRunWrites('chat-a', NOW - 1000);
    expect(repo.entries).toHaveLength(1);

    // Another chat touching the same path IS new history.
    provenance.recordRunWrites('chat-b', NOW - 1000);
    expect(repo.entries).toHaveLength(2);
  });
});
