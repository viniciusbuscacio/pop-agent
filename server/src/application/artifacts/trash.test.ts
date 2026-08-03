import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeClock } from '../../testing/app-fixture.js';
import { migrate } from '../../infrastructure/db/migrate.js';
import { SqliteArtifactRepo } from '../../infrastructure/db/sqlite-artifact-repo.js';
import { SqliteFolderRepo } from '../../infrastructure/db/sqlite-folder-repo.js';
import { FsArtifactStore } from '../../infrastructure/artifacts/artifact-store.js';
import { ArtifactService, TRASH_RETENTION_MS } from './artifact-service.js';
import { TrashSweeper } from './trash-sweeper.js';

/**
 * Against a real database on purpose: most of what the trash promises is
 * enforced by SQL -- the partial unique index that stops a deleted folder
 * blocking a new one, the listings that filter it out -- and a mock repo would
 * assert the intention rather than the behaviour.
 */

const KEY = Buffer.from('k'.repeat(32));

let root: string;
let db: Database.Database;
let clock: FakeClock;
let service: ArtifactService;
let deindexed: string[];
let reindexed: string[];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'popy-trash-'));
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  clock = new FakeClock();
  deindexed = [];
  reindexed = [];
  service = new ArtifactService({
    repo: new SqliteArtifactRepo(db),
    folders: new SqliteFolderRepo(db),
    store: new FsArtifactStore(root),
    secretKey: KEY,
    clock,
    onDeindexed: (id) => deindexed.push(id),
    onStored: (id) => reindexed.push(id),
  });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  db.close();
});

function upload(name: string, folderId = ''): string {
  return service.create({ chatId: '', folderId, name, mime: 'text/plain', source: 'upload' },
    Buffer.from(name)).id;
}

describe('the Files trash', () => {
  it('hides a deleted file from every listing but keeps its bytes', () => {
    const id = upload('nota.txt');
    const path = join(root, '_files', id);

    expect(service.delete(id)).toBe(true);

    expect(service.listAll()).toHaveLength(0);
    expect(service.get(id)).toBeUndefined();
    // The point of a trash: recoverable means the bytes are still there.
    expect(existsSync(path)).toBe(true);
    expect(service.listTrash().map((entry) => entry.name)).toEqual(['nota.txt']);
  });

  it('stops the agent finding a file the moment it is deleted', () => {
    // Thirty days of still being cited would be the worst kind of bug: silent,
    // and it makes Popy talk about something the user threw away.
    const id = upload('segredo.txt');
    service.delete(id);
    expect(deindexed).toEqual([id]);
  });

  it('restores a file and makes it findable again', () => {
    const id = upload('nota.txt');
    service.delete(id);
    reindexed.length = 0;

    expect(service.restore(id)).toBe('ok');
    expect(service.listAll().map((file) => file.name)).toEqual(['nota.txt']);
    expect(service.listTrash()).toHaveLength(0);
    expect(reindexed).toEqual([id]);
  });

  it('lets a new folder take the name of one sitting in the trash', () => {
    // The bin must not reach out and forbid something in the live tree.
    const folder = service.createFolder('Clientes');
    service.deleteFolder(folder.id);

    expect(() => service.createFolder('Clientes')).not.toThrow();
    expect(service.listFolders().map((entry) => entry.name)).toEqual(['Clientes']);
  });

  it('refuses a restore that would collide, instead of throwing', () => {
    const folder = service.createFolder('Clientes');
    service.deleteFolder(folder.id);
    service.createFolder('Clientes');

    expect(service.restoreFolder(folder.id)).toBe('name-taken');
    // Still in the trash, still recoverable once the live one is renamed.
    expect(service.listTrash()).toHaveLength(1);
  });

  it('takes a whole subtree down and brings it back as one thing', () => {
    const parent = service.createFolder('Projetos');
    const child = service.createFolder('specs', parent.id);
    const inside = upload('popy.md', child.id);

    service.deleteFolder(parent.id);
    expect(service.listFolders()).toHaveLength(0);
    expect(service.listAll()).toHaveLength(0);
    // One entry, not three: the user deleted a folder, not a pile of files.
    expect(service.listTrash()).toEqual([
      expect.objectContaining({ kind: 'folder', name: 'Projetos' }),
    ]);

    expect(service.restoreFolder(parent.id)).toBe('ok');
    expect(service.listFolders().map((entry) => entry.name).sort()).toEqual(['Projetos', 'specs']);
    expect(service.listAll().map((file) => file.id)).toEqual([inside]);
  });

  it('brings a folder back with the file when only the file is restored', () => {
    // Dropping it at the root instead would move something the user only asked
    // to undelete -- and a folder's parent is fixed at creation, so there is no
    // reparenting to fall back on.
    const folder = service.createFolder('Clientes');
    const id = upload('contrato.pdf', folder.id);
    service.deleteFolder(folder.id);

    expect(service.restore(id)).toBe('ok');
    expect(service.listFolders().map((entry) => entry.name)).toEqual(['Clientes']);
    expect(service.listAll().map((file) => file.id)).toEqual([id]);
  });

  it('shows where a trashed file came from', () => {
    const parent = service.createFolder('Projetos');
    const child = service.createFolder('specs', parent.id);
    const id = upload('popy.md', child.id);

    service.delete(id);
    expect(service.listTrash()[0]?.path).toBe('Projetos/specs');
  });

  it('says when each thing goes for good', () => {
    const id = upload('nota.txt');
    service.delete(id);

    const entry = service.listTrash()[0];
    const deleted = new Date(entry?.deletedAt ?? '').getTime();
    expect(new Date(entry?.purgeAt ?? '').getTime() - deleted).toBe(TRASH_RETENTION_MS);
  });

  it('keeps everything until the thirty days are up, then takes the bytes too', () => {
    const id = upload('nota.txt');
    const path = join(root, '_files', id);
    service.delete(id);

    clock.advance(TRASH_RETENTION_MS - 1000);
    expect(service.purgeExpired()).toBe(0);
    expect(existsSync(path)).toBe(true);

    clock.advance(2000);
    expect(service.purgeExpired()).toBe(1);
    expect(existsSync(path)).toBe(false);
    expect(service.listTrash()).toHaveLength(0);
    // Gone for good means gone: no restore, and no row left behind.
    expect(service.restore(id)).toBe('not-found');
  });

  it('takes the archived copies with the file, not just the current bytes', () => {
    // Otherwise a purge frees only part of what the storage screen blamed on
    // the file, and the rest stays under a name nothing points at.
    const id = upload('nota.txt');
    upload('nota.txt'); // same name in the root: a second version
    const archived = join(root, '_files', `${id}.v1`);
    expect(existsSync(archived)).toBe(true);

    service.delete(id);
    service.emptyTrash();
    expect(existsSync(archived)).toBe(false);
  });

  it('empties on demand without waiting for the window', () => {
    const folder = service.createFolder('Clientes');
    upload('contrato.pdf', folder.id);
    upload('solto.txt');
    service.deleteFolder(folder.id);
    service.delete(service.listAll()[0]?.id ?? '');

    expect(service.emptyTrash()).toBeGreaterThan(0);
    expect(service.listTrash()).toHaveLength(0);
    expect(service.listFolders()).toHaveLength(0);
  });

  it('purges one trashed folder without touching the rest of the trash', () => {
    const keep = service.createFolder('Guardar');
    const drop = service.createFolder('Descartar');
    upload('fica.txt', keep.id);
    service.deleteFolder(keep.id);
    service.deleteFolder(drop.id);

    expect(service.purgeFolder(drop.id)).toBe(true);
    expect(service.listTrash().map((entry) => entry.name)).toEqual(['Guardar']);
    expect(service.restoreFolder(keep.id)).toBe('ok');
  });

  it('does not resurrect a file whose download link was minted before the delete', () => {
    const id = upload('nota.txt');
    const link = service.mintLink(id);
    service.delete(id);

    const url = new URL(`http://x${link?.url ?? ''}`);
    const resolved = service.resolveDownload(
      id,
      url.searchParams.get('expires') ?? undefined,
      url.searchParams.get('sig') ?? undefined,
    );
    expect(resolved.status).toBe('not-found');
  });
});

describe('TrashSweeper', () => {
  it('survives a failing sweep and says so, rather than taking the tick down', () => {
    const lines: string[] = [];
    const sweeper = new TrashSweeper({
      artifacts: {
        purgeExpired: () => {
          throw new Error('disk is angry');
        },
      } as unknown as ArtifactService,
      onJournal: (line) => lines.push(line),
    });

    expect(() => sweeper.run()).not.toThrow();
    expect(lines[0]).toContain('disk is angry');
  });

  it('stays quiet when there was nothing to purge', () => {
    // A daily line saying zero is how a log stops being read.
    const purgeExpired = vi.fn(() => 0);
    const lines: string[] = [];
    new TrashSweeper({
      artifacts: { purgeExpired } as unknown as ArtifactService,
      onJournal: (line) => lines.push(line),
    }).run();

    expect(purgeExpired).toHaveBeenCalled();
    expect(lines).toEqual([]);
  });
});
