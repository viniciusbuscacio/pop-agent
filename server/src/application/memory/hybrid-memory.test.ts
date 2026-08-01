import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { newChatId, newMessageId } from '../../domain/ids.js';
import { migrate } from '../../infrastructure/db/migrate.js';
import { SqliteChatRepo } from '../../infrastructure/db/sqlite-chat-repo.js';
import { SqliteEmbeddingsRepo } from '../../infrastructure/db/sqlite-embeddings-repo.js';
import { SqliteMemoryRepo } from '../../infrastructure/db/sqlite-memory-repo.js';
import type { Embedder } from '../ports/embedder.js';
import { HybridMemory } from './hybrid-memory.js';

/** A stub embedder mapping known phrases to fixed unit vectors. */
class StubEmbedder implements Embedder {
  readonly dimension = 3;
  constructor(private readonly vectors: Record<string, number[]>) {}
  embed(texts: string[]): Promise<Float32Array[]> {
    return Promise.resolve(
      texts.map((text) => {
        const key = Object.keys(this.vectors).find((k) => text.includes(k));
        return Float32Array.from(this.vectors[key ?? ''] ?? [0, 0, 1]);
      }),
    );
  }
}

let db: Database.Database;
let chats: SqliteChatRepo;
let memory: SqliteMemoryRepo;
let embeddings: SqliteEmbeddingsRepo;

function chat(title: string): string {
  const id = newChatId();
  chats.create({ id, title, model: '', provider: '', archived: false, piSessionId: '', summary: '', autoTitle: true, createdAt: 'T', updatedAt: 'T' });
  return id;
}
function say(chatId: string, content: string): number {
  chats.appendMessage({ id: newMessageId(), chatId, role: 'user', content, thinking: '', tools: [], attachments: [], createdAt: 'T' });
  return (db.prepare('SELECT rowid FROM messages ORDER BY rowid DESC LIMIT 1').get() as { rowid: number }).rowid;
}

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  chats = new SqliteChatRepo(db);
  memory = new SqliteMemoryRepo(db);
  embeddings = new SqliteEmbeddingsRepo(db);
});

describe('HybridMemory', () => {
  it('falls back to pure FTS with no embedder', async () => {
    const c = chat('Trip');
    say(c, 'we should book flights to Recife');
    const hybrid = new HybridMemory({ memory });

    const hits = await hybrid.search('flights');
    expect(hits[0]?.chatId).toBe(c);
  });

  it('finds a message by meaning even when it shares no words with the query', async () => {
    const c = chat('Trip');
    const rowid = say(c, 'we should book flights to Recife');
    // Query and message share no tokens, but their vectors match.
    embeddings.save(rowid, Float32Array.from([1, 0, 0]));
    const embedder = new StubEmbedder({ 'travel plans': [1, 0, 0] });
    const hybrid = new HybridMemory({ memory, embeddings, embedder });

    const hits = await hybrid.search('what were our travel plans');
    expect(hits.map((h) => h.chatId)).toContain(c);
  });

  it('fuses lexical and semantic so a doubly-relevant chat ranks first', async () => {
    const a = chat('A');
    const b = chat('B');
    const ra = say(a, 'the deploy pipeline broke on friday');
    say(b, 'unrelated grocery list');
    embeddings.save(ra, Float32Array.from([1, 0, 0]));
    const embedder = new StubEmbedder({ 'deploy': [1, 0, 0] });
    const hybrid = new HybridMemory({ memory, embeddings, embedder });

    const hits = await hybrid.search('deploy');
    expect(hits[0]?.chatId).toBe(a);
  });
});
