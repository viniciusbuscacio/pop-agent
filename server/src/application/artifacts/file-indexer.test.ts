import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeClock } from '../../testing/app-fixture.js';
import { migrate } from '../../infrastructure/db/migrate.js';
import { SqliteArtifactRepo } from '../../infrastructure/db/sqlite-artifact-repo.js';
import { SqliteArtifactChunksRepo } from '../../infrastructure/db/sqlite-artifact-chunks-repo.js';
import { SqliteFolderRepo } from '../../infrastructure/db/sqlite-folder-repo.js';
import { FsArtifactStore } from '../../infrastructure/artifacts/artifact-store.js';
import type { Embedder } from '../ports/embedder.js';
import { ArtifactService } from './artifact-service.js';
import { chunk, FileIndexer } from './file-indexer.js';

/**
 * A deterministic embedder: one dimension per known word, so the cosine
 * ranking is exactly "which text mentions the word".
 */
const WORDS = ['gato', 'cachorro', 'contrato'];
const fakeEmbedder: Embedder = {
  embed: (texts) =>
    Promise.resolve(
      texts.map((entry) => {
        const vector = new Float32Array(WORDS.length + 1);
        WORDS.forEach((word, i) => {
          vector[i] = entry.toLowerCase().includes(word) ? 1 : 0;
        });
        vector[WORDS.length] = 0.01; // never a zero vector
        return vector;
      }),
    ),
  dimension: WORDS.length + 1,
};

let root: string;
let db: Database.Database;
let service: ArtifactService;
let chunks: SqliteArtifactChunksRepo;
let indexer: FileIndexer;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'popy-fileindex-'));
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  chunks = new SqliteArtifactChunksRepo(db);
  service = new ArtifactService({
    repo: new SqliteArtifactRepo(db),
    folders: new SqliteFolderRepo(db),
    store: new FsArtifactStore(root),
    secretKey: Buffer.from('k'.repeat(32)),
    clock: new FakeClock(),
    // Wired exactly the way main.ts wires it: the trash keeps the row, so
    // dropping the chunks is now the service's job, not the FK's.
    onDeindexed: (artifactId) => chunks.replaceFor(artifactId, []),
  });
  indexer = new FileIndexer({
    artifacts: service,
    chunks,
    embedder: fakeEmbedder,
    extractor: { extract: () => Promise.resolve(undefined) },
  });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function storeText(name: string, content: string) {
  return service.create(
    { chatId: '', name, mime: 'text/plain', source: 'upload' },
    Buffer.from(content),
  );
}

describe('FileIndexer', () => {
  it('indexes a stored file and finds it by meaning', async () => {
    const cat = storeText('gatos.txt', 'o gato subiu no telhado');
    storeText('caes.txt', 'o cachorro late no quintal');
    await indexer.backfill();

    const hits = await indexer.search('gato');
    expect(hits[0]?.artifactId).toBe(cat.id);
    expect(hits[0]?.name).toBe('gatos.txt');
    expect(hits[0]?.snippet).toContain('telhado');
  });

  it('drops a deleted file from the index at once, before the trash expires', async () => {
    // The FK cascade used to do this, because delete meant delete. With a
    // trash the row survives, so the service reports it instead -- and it has
    // to, or the agent keeps citing a file the user threw away for thirty days.
    const doc = storeText('contrato.txt', 'o contrato de aluguel');
    await indexer.backfill();
    expect(chunks.indexedArtifactIds().has(doc.id)).toBe(true);

    service.delete(doc.id);
    expect(chunks.indexedArtifactIds().has(doc.id)).toBe(false);
  });

  it('re-indexing replaces, never duplicates', async () => {
    const doc = storeText('contrato.txt', 'o contrato de aluguel');
    await indexer.index(doc.id);
    await indexer.index(doc.id);
    expect(chunks.all().filter((entry) => entry.artifactId === doc.id)).toHaveLength(1);
  });
});

describe('chunk', () => {
  it('packs paragraphs and splits an oversized one', () => {
    const paragraphs = chunk('a\n\nb\n\nc');
    expect(paragraphs).toEqual(['a\n\nb\n\nc']);
    expect(chunk('x'.repeat(3000)).length).toBeGreaterThan(1);
  });
});
