import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeClock } from '../../testing/app-fixture.js';
import { migrate } from '../../infrastructure/db/migrate.js';
import { SqliteArtifactRepo } from '../../infrastructure/db/sqlite-artifact-repo.js';
import { SqliteFolderRepo } from '../../infrastructure/db/sqlite-folder-repo.js';
import { SqlitePathIndexRepo } from '../../infrastructure/db/sqlite-path-index-repo.js';
import { FsArtifactStore } from '../../infrastructure/artifacts/artifact-store.js';
import { ArtifactService } from './artifact-service.js';
import { PathIndexService } from './path-index.js';

const KEY = Buffer.from('k'.repeat(32));

let root: string;
let db: Database.Database;
let store: FsArtifactStore;
let service: ArtifactService;
let pathIndex: PathIndexService;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'popy-pathindex-'));
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  store = new FsArtifactStore(root);
  const artifactRepo = new SqliteArtifactRepo(db);
  const folderRepo = new SqliteFolderRepo(db);
  pathIndex = new PathIndexService({
    folders: folderRepo,
    artifacts: artifactRepo,
    index: new SqlitePathIndexRepo(db),
  });
  service = new ArtifactService({
    repo: artifactRepo,
    folders: folderRepo,
    store,
    secretKey: KEY,
    clock: new FakeClock(),
    onFilesChanged: () => pathIndex.reindex(),
  });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('PathIndexService', () => {
  it('finds a folder by name and carries its full path', () => {
    const projects = service.createFolder('Projects');
    service.createFolder('specs', projects.id);

    const hits = pathIndex.search('specs');
    expect(hits).toHaveLength(1);
    expect(hits[0]?.kind).toBe('folder');
    expect(hits[0]?.path).toBe('Projects/specs');
  });

  it('finds a file anywhere in the tree, by name or by a path segment', () => {
    const projects = service.createFolder('Projects');
    const specs = service.createFolder('specs', projects.id);
    service.create(
      { chatId: '', folderId: specs.id, name: 'popy.md', mime: 'text/markdown', source: 'upload' },
      Buffer.from('# popy'),
    );

    expect(pathIndex.search('popy.md').map((h) => h.path)).toEqual(['Projects/specs/popy.md']);
    // A path segment matches too -- everything under Projects.
    const underProjects = pathIndex.search('Projects');
    expect(underProjects.some((h) => h.kind === 'file' && h.name === 'popy.md')).toBe(true);
    // Folders sort before files.
    expect(underProjects[0]?.kind).toBe('folder');
  });

  it('drops an entry once its file is deleted (the index tracks mutations)', () => {
    const file = service.create(
      { chatId: '', name: 'loose.txt', mime: 'text/plain', source: 'upload' },
      Buffer.from('x'),
    );
    expect(pathIndex.search('loose')).toHaveLength(1);
    service.delete(file.id);
    expect(pathIndex.search('loose')).toHaveLength(0);
  });

  it('returns nothing for an empty query', () => {
    service.createFolder('Anything');
    expect(pathIndex.search('   ')).toEqual([]);
  });

  it('treats a LIKE metacharacter as a literal', () => {
    service.createFolder('100% done');
    expect(pathIndex.search('100%').map((h) => h.name)).toEqual(['100% done']);
    // A bare wildcard must not match everything.
    service.createFolder('plain');
    expect(pathIndex.search('%')).toHaveLength(1);
  });
});
