import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeClock } from '../../testing/app-fixture.js';
import { migrate } from '../../infrastructure/db/migrate.js';
import { SqliteArtifactRepo } from '../../infrastructure/db/sqlite-artifact-repo.js';
import { SqliteFolderRepo } from '../../infrastructure/db/sqlite-folder-repo.js';
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
    folders: new SqliteFolderRepo(db),
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

  it('versions a re-save under the same name, keeping the old bytes', () => {
    const v1 = service.create(
      { chatId: 'chat-1', name: 'doc.txt', mime: 'text/plain', source: 'upload' },
      Buffer.from('first'),
    );
    const v2 = service.create(
      { chatId: 'chat-1', name: 'doc.txt', mime: 'text/plain', source: 'agent' },
      Buffer.from('second draft'),
    );

    // Same artifact id, bumped version, and only one artifact in the chat.
    expect(v2.id).toBe(v1.id);
    expect(v2.version).toBe(2);
    expect(service.list('chat-1')).toHaveLength(1);

    // History has both, newest first.
    expect(service.listVersions(v1.id).map((h) => h.version)).toEqual([2, 1]);

    // Latest download serves v2; the archived v1 still serves the old bytes.
    expect(readFileSync(store.pathOf('chat-1', v1.id), 'utf8')).toBe('second draft');
    expect(readFileSync(store.pathOfVersion('chat-1', v1.id, 1), 'utf8')).toBe('first');
  });

  it('resolves a versioned link to the right bytes and rejects a forgery', () => {
    const v1 = service.create(
      { chatId: 'chat-1', name: 'doc.txt', mime: 'text/plain', source: 'upload' },
      Buffer.from('first'),
    );
    service.create(
      { chatId: 'chat-1', name: 'doc.txt', mime: 'text/plain', source: 'agent' },
      Buffer.from('second'),
    );

    const link = service.mintVersionLink(v1.id, 1);
    expect(link).toBeDefined();
    const query = new URL(link!.url, 'http://x').searchParams;
    const resolution = service.resolveVersionDownload(
      v1.id,
      1,
      query.get('expires') ?? undefined,
      query.get('sig') ?? undefined,
    );
    expect(resolution.status).toBe('ok');
    if (resolution.status === 'ok') {
      expect(readFileSync(resolution.path, 'utf8')).toBe('first');
    }

    expect(service.resolveVersionDownload(v1.id, 1, '9999999999999', 'forged').status).toBe(
      'bad-signature',
    );
    expect(service.mintVersionLink(v1.id, 9)).toBeUndefined();
  });

  describe('nested folders', () => {
    it('creates a subfolder and allows the same name under a different parent', () => {
      const projects = service.createFolder('Projects');
      const clients = service.createFolder('Clients');
      const specsA = service.createFolder('specs', projects.id);
      const specsB = service.createFolder('specs', clients.id);

      expect(specsA.parentId).toBe(projects.id);
      expect(specsB.parentId).toBe(clients.id);
      expect(service.getFolder(specsA.id)?.name).toBe('specs');
      // Two 'specs' can coexist under different parents.
      expect(service.listFolders().filter((f) => f.name === 'specs')).toHaveLength(2);
    });

    it('rejects a duplicate name among siblings', () => {
      const parent = service.createFolder('Parent');
      service.createFolder('dup', parent.id);
      expect(() => service.createFolder('dup', parent.id)).toThrow();
    });

    it('deletes a folder and its whole subtree -- descendant folders and their files, bytes and all', () => {
      const top = service.createFolder('top');
      const mid = service.createFolder('mid', top.id);
      const leaf = service.createFolder('leaf', mid.id);

      const atTop = service.create(
        { chatId: '', folderId: top.id, name: 'a.txt', mime: 'text/plain', source: 'upload' },
        Buffer.from('a'),
      );
      const atLeaf = service.create(
        { chatId: '', folderId: leaf.id, name: 'b.txt', mime: 'text/plain', source: 'upload' },
        Buffer.from('b'),
      );
      const topBytes = store.pathOf('', atTop.id);
      const leafBytes = store.pathOf('', atLeaf.id);
      expect(existsSync(topBytes)).toBe(true);
      expect(existsSync(leafBytes)).toBe(true);

      expect(service.deleteFolder(top.id)).toBe(true);

      // Every folder in the subtree is gone.
      expect(service.getFolder(top.id)).toBeUndefined();
      expect(service.getFolder(mid.id)).toBeUndefined();
      expect(service.getFolder(leaf.id)).toBeUndefined();
      // Every file in the subtree is gone, records and bytes both.
      expect(service.get(atTop.id)).toBeUndefined();
      expect(service.get(atLeaf.id)).toBeUndefined();
      expect(existsSync(topBytes)).toBe(false);
      expect(existsSync(leafBytes)).toBe(false);
    });

    it('reports a change through onFilesChanged for folder and file mutations', () => {
      let changes = 0;
      const witness = new ArtifactService({
        repo: new SqliteArtifactRepo(db),
        folders: new SqliteFolderRepo(db),
        store,
        secretKey: KEY,
        clock: new FakeClock(),
        onFilesChanged: () => {
          changes += 1;
        },
      });
      const folder = witness.createFolder('watched');
      witness.create(
        { chatId: '', folderId: folder.id, name: 'c.txt', mime: 'text/plain', source: 'upload' },
        Buffer.from('c'),
      );
      witness.deleteFolder(folder.id);
      expect(changes).toBe(3);
    });
  });
});
