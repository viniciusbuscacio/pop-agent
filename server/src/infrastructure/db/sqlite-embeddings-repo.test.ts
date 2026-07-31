import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { newChatId, newMessageId } from '../../domain/ids.js';
import { migrate } from './migrate.js';
import { SqliteChatRepo } from './sqlite-chat-repo.js';
import { SqliteEmbeddingsRepo } from './sqlite-embeddings-repo.js';

let db: Database.Database;
let chats: SqliteChatRepo;
let embeddings: SqliteEmbeddingsRepo;
let chatId: string;
let rowid: number;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  chats = new SqliteChatRepo(db);
  embeddings = new SqliteEmbeddingsRepo(db);
  chatId = newChatId();
  chats.create({ id: chatId, title: 'x', model: '', archived: false, piSessionId: '', summary: '', autoTitle: true, createdAt: 'T', updatedAt: 'T' });
  chats.appendMessage({ id: newMessageId(), chatId, role: 'user', content: 'hi', thinking: '', tools: [], attachments: [], createdAt: 'T' });
  rowid = (db.prepare('SELECT rowid FROM messages LIMIT 1').get() as { rowid: number }).rowid;
});

describe('SqliteEmbeddingsRepo', () => {
  it('round-trips a vector as a BLOB', () => {
    embeddings.save(rowid, Float32Array.from([0.1, 0.2, 0.3]));
    const stored = embeddings.all();
    expect(stored).toHaveLength(1);
    expect(Array.from(stored[0]!.vector)).toEqual([
      Math.fround(0.1),
      Math.fround(0.2),
      Math.fround(0.3),
    ]);
    expect(stored[0]!.chatId).toBe(chatId);
  });

  it('drops the embedding when the message (and its chat) is deleted', () => {
    embeddings.save(rowid, Float32Array.from([1, 0]));
    chats.delete(chatId);
    expect(embeddings.all()).toHaveLength(0);
  });
});
