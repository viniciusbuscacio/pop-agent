import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from './migrate.js';
import { SqliteFileProvenanceRepo } from './sqlite-file-provenance-repo.js';

let db: Database.Database;
let repo: SqliteFileProvenanceRepo;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  repo = new SqliteFileProvenanceRepo(db);
});

afterEach(() => {
  db.close();
});

describe('file provenance log', () => {
  it('records and answers which chat most recently wrote a path', () => {
    repo.record({ id: 'prov-1', chatId: 'chat-a', path: 'r.pdf', createdAt: '2026-08-05T10:00:00Z' });
    repo.record({ id: 'prov-2', chatId: 'chat-b', path: 'r.pdf', createdAt: '2026-08-05T11:00:00Z' });

    expect(repo.latestChatFor('r.pdf')).toBe('chat-b');
    expect(repo.latestChatFor('missing.txt')).toBeUndefined();
  });

  it('lists what a chat wrote, newest first, and history survives everything', () => {
    repo.record({ id: 'prov-1', chatId: 'chat-a', path: 'old.txt', createdAt: '2026-08-05T10:00:00Z' });
    repo.record({ id: 'prov-2', chatId: 'chat-a', path: 'new.txt', createdAt: '2026-08-05T11:00:00Z' });

    expect(repo.listByChat('chat-a').map((entry) => entry.path)).toEqual(['new.txt', 'old.txt']);
    // No foreign key on purpose: the chat may be long gone.
    expect(repo.listByChat('chat-never-existed')).toEqual([]);
  });
});
