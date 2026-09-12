import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { newChatId, newMessageId } from '../../domain/ids.js';
import { migrate } from '../../infrastructure/db/migrate.js';
import { SqliteChatRepo } from '../../infrastructure/db/sqlite-chat-repo.js';
import { SqliteEmbeddingsRepo } from '../../infrastructure/db/sqlite-embeddings-repo.js';
import type { Embedder } from '../ports/embedder.js';
import { EmbeddingIndexer } from './embedding-indexer.js';

class CountingEmbedder implements Embedder {
  readonly dimension = 2;
  calls = 0;
  embed(texts: string[]): Promise<Float32Array[]> {
    this.calls += 1;
    return Promise.resolve(texts.map(() => Float32Array.from([1, 0])));
  }
}

let db: Database.Database;
let chats: SqliteChatRepo;
let embeddings: SqliteEmbeddingsRepo;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  chats = new SqliteChatRepo(db);
  embeddings = new SqliteEmbeddingsRepo(db);
  const c = newChatId();
  chats.create({ id: c, title: 'x', model: '', provider: '', archived: false, pinned: false, piSessionId: '', summary: '', autoTitle: true, createdAt: 'T', updatedAt: 'T' });
  for (let i = 0; i < 3; i += 1) {
    chats.appendMessage({ id: newMessageId(), chatId: c, role: 'user', content: `message ${i}`, thinking: '', tools: [], attachments: [], createdAt: 'T' });
  }
});

describe('EmbeddingIndexer', () => {
  it('backfills every pending message', async () => {
    expect(embeddings.pendingCount()).toBe(3);
    const indexer = new EmbeddingIndexer({ embeddings, embedder: new CountingEmbedder() });

    await indexer.backfill();

    expect(embeddings.pendingCount()).toBe(0);
    expect(embeddings.all()).toHaveLength(3);
  });

  it('is a no-op when nothing is pending', async () => {
    const embedder = new CountingEmbedder();
    const indexer = new EmbeddingIndexer({ embeddings, embedder });
    await indexer.backfill();
    embedder.calls = 0;

    await indexer.backfill();
    expect(embedder.calls).toBe(0);
  });

  it('survives an embedder that throws', async () => {
    const embedder: Embedder = { dimension: 2, embed: () => Promise.reject(new Error('down')) };
    const errors: string[] = [];
    const indexer = new EmbeddingIndexer({ embeddings, embedder, onError: (m) => errors.push(m) });

    await indexer.backfill();
    expect(errors.length).toBeGreaterThan(0);
    expect(embeddings.pendingCount()).toBe(3);
  });
});
