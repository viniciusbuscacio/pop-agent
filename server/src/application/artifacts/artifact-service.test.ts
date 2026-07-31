import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeClock } from '../../testing/app-fixture.js';
import { migrate } from '../../infrastructure/db/migrate.js';
import { SqliteArtifactRepo } from '../../infrastructure/db/sqlite-artifact-repo.js';
import { FsArtifactStore } from '../../infrastructure/artifacts/artifact-store.js';
import { ArtifactService } from './artifact-service.js';

const KEY = Buffer.from('k'.repeat(32));

let root: string;
let db: Database.Database;
let store: FsArtifactStore;
let service: ArtifactService;

function seedChat(id: string): void {
  db.prepare(
    `INSERT INTO chats (id, title, model, archived, pi_session_id, summary, auto_title, created_at, updated_at)
     VALUES (?, '', '', 0, '', '', 0, '2026-07-31T09:00:00.000Z', '2026-07-31T09:00:00.000Z')`,
  ).run(id);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'popy-artifacts-'));
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  seedChat('chat-1');
  store = new FsArtifactStore(root);
  service = new ArtifactService({
    repo: new SqliteArtifactRepo(db),
    store,
    secretKey: KEY,
    clock: new FakeClock(),
  });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('ArtifactService', () => {
  it('stores bytes and lists the record', () => {
    const artifact = service.create(
      { chatId: 'chat-1', name: 'report.txt', mime: 'text/plain', source: 'agent' },
      Buffer.from('hello world'),
    );

    expect(artifact.size).toBe(11);
    expect(service.list('chat-1').map((a) => a.id)).toEqual([artifact.id]);
    expect(readFileSync(store.pathOf('chat-1', artifact.id), 'utf8')).toBe('hello world');
  });

  it('resolves a valid signed link and points at the right file', () => {
    const artifact = service.create(
      { chatId: 'chat-1', name: 'a.txt', mime: 'text/plain', source: 'upload' },
      Buffer.from('bytes'),
    );
    const link = service.mintLink(artifact.id);
    expect(link).toBeDefined();

    const query = new URL(link!.url, 'http://x').searchParams;
    const resolution = service.resolveDownload(
      artifact.id,
      query.get('expires') ?? undefined,
      query.get('sig') ?? undefined,
    );
    expect(resolution.status).toBe('ok');
    if (resolution.status === 'ok') {
      expect(resolution.path).toBe(store.pathOf('chat-1', artifact.id));
    }
  });

  it('refuses a forged signature and an unknown id', () => {
    const artifact = service.create(
      { chatId: 'chat-1', name: 'a.txt', mime: 'text/plain', source: 'agent' },
      Buffer.from('x'),
    );
    expect(service.resolveDownload(artifact.id, '9999999999999', 'forged').status).toBe(
      'bad-signature',
    );
    expect(service.mintLink('file-does-not-exist')).toBeUndefined();
  });

  it('deletes the record and the bytes', () => {
    const artifact = service.create(
      { chatId: 'chat-1', name: 'a.txt', mime: 'text/plain', source: 'agent' },
      Buffer.from('x'),
    );
    const path = store.pathOf('chat-1', artifact.id);

    expect(service.delete(artifact.id)).toBe(true);
    expect(service.get(artifact.id)).toBeUndefined();
    expect(existsSync(path)).toBe(false);
    expect(service.delete(artifact.id)).toBe(false);
  });
});
