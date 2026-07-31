import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { createArtifact } from '../../domain/artifacts/artifact.js';
import { migrate } from './migrate.js';
import { SqliteArtifactRepo } from './sqlite-artifact-repo.js';

let db: Database.Database;
let repo: SqliteArtifactRepo;

beforeEach(() => {
  db = new Database(':memory:');
  migrate(db);
  repo = new SqliteArtifactRepo(db);
  seedChat('chat-1');
  seedChat('chat-2');
});

function seedChat(id: string): void {
  db.prepare(
    `INSERT INTO chats (id, title, model, archived, pi_session_id, summary, auto_title, created_at, updated_at)
     VALUES (?, '', '', 0, '', '', 0, '2026-07-31T09:00:00.000Z', '2026-07-31T09:00:00.000Z')`,
  ).run(id);
}

describe('SqliteArtifactRepo', () => {
  it('stores and reads a record back', () => {
    const stored = repo.insert(
      createArtifact(
        { chatId: 'chat-1', name: 'report.pdf', mime: 'application/pdf', size: 2048, source: 'agent' },
        '2026-07-31T10:00:00.000Z',
      ),
    );

    expect(stored.id).toMatch(/^file-[0-9A-Za-z]{11}$/);
    expect(repo.get(stored.id)).toEqual(stored);
  });

  it('lists a chat\'s artifacts oldest first and ignores other chats', () => {
    const mine = repo.insert(
      createArtifact(
        { chatId: 'chat-1', name: 'a.txt', mime: 'text/plain', size: 1, source: 'agent' },
        '2026-07-31T10:00:00.000Z',
      ),
    );
    const alsoMine = repo.insert(
      createArtifact(
        { chatId: 'chat-1', name: 'b.txt', mime: 'text/plain', size: 1, source: 'upload' },
        '2026-07-31T11:00:00.000Z',
      ),
    );
    repo.insert(
      createArtifact(
        { chatId: 'chat-2', name: 'c.txt', mime: 'text/plain', size: 1, source: 'agent' },
        '2026-07-31T12:00:00.000Z',
      ),
    );

    expect(repo.listByChat('chat-1').map((a) => a.id)).toEqual([mine.id, alsoMine.id]);
  });

  it('deletes a record and reports whether anything was removed', () => {
    const stored = repo.insert(
      createArtifact(
        { chatId: 'chat-1', name: 'a.txt', mime: 'text/plain', size: 1, source: 'agent' },
        '2026-07-31T10:00:00.000Z',
      ),
    );

    expect(repo.delete(stored.id)).toBe(true);
    expect(repo.get(stored.id)).toBeUndefined();
    expect(repo.delete(stored.id)).toBe(false);
  });
});
