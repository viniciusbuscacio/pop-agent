import Database from 'better-sqlite3';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FileProvenanceRepo, ProvenanceEntry } from '../../application/ports/file-provenance-repo.js';
import { readLegacyCatalog, writeLegacyFiles } from './legacy-files-export.js';

class MemoryProvenance implements FileProvenanceRepo {
  entries: ProvenanceEntry[] = [];
  record(entry: ProvenanceEntry): void {
    this.entries.push(entry);
  }
  latestChatFor(): string | undefined {
    return undefined;
  }
  listByChat(): { path: string; createdAt: string }[] {
    return [];
  }
}

let root: string;
let dbPath: string;
let artifactsDir: string;
let filesDir: string;

/** The pre-1.58 schema, just enough of it for the reader. */
function seedLegacyDb(): void {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE folders (id TEXT PRIMARY KEY, name TEXT, parent_id TEXT, created_at TEXT, deleted_at TEXT);
    CREATE TABLE artifacts (id TEXT PRIMARY KEY, chat_id TEXT, folder_id TEXT, name TEXT,
                            mime TEXT, size INTEGER, version INTEGER, source TEXT,
                            created_at TEXT, updated_at TEXT, deleted_at TEXT);
  `);
  db.prepare(`INSERT INTO folders VALUES ('folder-a', 'Docs', NULL, '2026-08-01', NULL)`).run();
  db.prepare(`INSERT INTO folders VALUES ('folder-b', '2026', 'folder-a', '2026-08-01', NULL)`).run();
  db.prepare(
    `INSERT INTO artifacts VALUES ('file-1', 'chat-x', 'folder-b', 'report.txt', 'text/plain', 2, 1, 'agent', '2026-08-01', '2026-08-01', NULL)`,
  ).run();
  db.prepare(
    `INSERT INTO artifacts VALUES ('file-2', '', NULL, 'upload.txt', 'text/plain', 2, 1, 'upload', '2026-08-02', '2026-08-02', NULL)`,
  ).run();
  db.prepare(
    `INSERT INTO artifacts VALUES ('file-3', 'chat-x', NULL, 'old.txt', 'text/plain', 2, 1, 'agent', '2026-08-03', '2026-08-03', '2026-08-04')`,
  ).run();
  db.close();

  mkdirSync(join(artifactsDir, 'chat-x'), { recursive: true });
  mkdirSync(join(artifactsDir, '_files'), { recursive: true });
  writeFileSync(join(artifactsDir, 'chat-x', 'file-1'), 'r1');
  writeFileSync(join(artifactsDir, '_files', 'file-2'), 'u2');
  writeFileSync(join(artifactsDir, 'chat-x', 'file-3'), 'o3');
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'popy-legacy-'));
  dbPath = join(root, 'popy.db');
  artifactsDir = join(root, 'artifacts');
  filesDir = join(root, 'files');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('legacy files export', () => {
  it('is silent on a fresh or already-migrated install', () => {
    expect(readLegacyCatalog(dbPath, artifactsDir)).toBeUndefined();
    const db = new Database(dbPath);
    db.exec('CREATE TABLE chats (id TEXT PRIMARY KEY)');
    db.close();
    expect(readLegacyCatalog(dbPath, artifactsDir)).toBeUndefined();
  });

  it('lands live rows under their folder path, trashed rows in Garbage, and seeds provenance', () => {
    seedLegacyDb();
    const catalog = readLegacyCatalog(dbPath, artifactsDir);
    expect(catalog).toBeDefined();

    const provenance = new MemoryProvenance();
    const landed = writeLegacyFiles(catalog as NonNullable<typeof catalog>, filesDir, provenance);

    expect(landed).toBe(3);
    expect(readFileSync(join(filesDir, 'Docs/2026/report.txt'), 'utf8')).toBe('r1');
    expect(readFileSync(join(filesDir, 'upload.txt'), 'utf8')).toBe('u2');
    expect(readFileSync(join(filesDir, 'Garbage/old.txt'), 'utf8')).toBe('o3');

    const notes = JSON.parse(readFileSync(join(filesDir, 'Garbage/.garbage.json'), 'utf8')) as Record<
      string,
      { originalPath: string; deletedAt: string }
    >;
    expect(notes['old.txt']).toEqual({ originalPath: 'old.txt', deletedAt: '2026-08-04' });

    // Provenance carries the original authorship; uploads have no chat to name.
    expect(provenance.entries).toHaveLength(1);
    expect(provenance.entries[0]).toMatchObject({ chatId: 'chat-x', path: 'Docs/2026/report.txt' });

    // The old store is gone; its bytes must not ride every future backup.
    expect(existsSync(artifactsDir)).toBe(false);
  });
});
