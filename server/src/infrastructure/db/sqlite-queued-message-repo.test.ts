import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase } from './database.js';
import { SqliteChatRepo } from './sqlite-chat-repo.js';
import { SqliteQueuedMessageRepo } from './sqlite-queued-message-repo.js';

const CHAT = {
  id: 'chat-queue-test',
  title: 'Queue test',
  model: '',
  provider: '',
  archived: false,
  pinned: false,
  piSessionId: '',
  summary: '',
  autoTitle: true,
  createdAt: '2026-08-09T00:00:00.000Z',
  updatedAt: '2026-08-09T00:00:00.000Z',
};

describe('sqlite queued messages', () => {
  it('survives closing and reopening the server database', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'pop-queue-')), 'pop-agent.db');
    const first = openDatabase(file);
    new SqliteChatRepo(first).create(CHAT);
    expect(
      new SqliteQueuedMessageRepo(first).create({
        id: 'queued-one',
        chatId: CHAT.id,
        text: 'survive restart',
        deliveryMode: 'follow_up',
        attachments: [{ name: 'a.txt', type: 'text/plain', dataUri: 'data:text/plain;base64,YQ==' }],
        filePaths: ['folder/report.txt'],
        createdAt: CHAT.createdAt,
        updatedAt: CHAT.updatedAt,
      }),
    ).toBe(true);
    first.close();

    const second = openDatabase(file);
    expect(new SqliteQueuedMessageRepo(second).get(CHAT.id)).toMatchObject({
      text: 'survive restart',
      deliveryMode: 'follow_up',
      filePaths: ['folder/report.txt'],
      attachments: [{ name: 'a.txt' }],
    });
    second.close();
  });

  it('keeps multiple rows per chat in insertion order', () => {
    const db = openDatabase(':memory:');
    new SqliteChatRepo(db).create(CHAT);
    const repo = new SqliteQueuedMessageRepo(db);
    const message = {
      id: 'queued-one',
      chatId: CHAT.id,
      text: 'first',
      deliveryMode: 'steer' as const,
      attachments: [],
      filePaths: [],
      createdAt: CHAT.createdAt,
      updatedAt: CHAT.updatedAt,
    };
    expect(repo.create(message)).toBe(true);
    expect(repo.create({ ...message, id: 'queued-two', text: 'second' })).toBe(true);
    expect(repo.count(CHAT.id)).toBe(2);
    expect(repo.get(CHAT.id)?.text).toBe('first');
    expect(repo.getById(CHAT.id, 'queued-two')?.text).toBe('second');
    expect(repo.list(CHAT.id).map((item) => item.text)).toEqual(['first', 'second']);
    expect(repo.delete('queued-one')).toBe(true);
    expect(repo.get(CHAT.id)?.text).toBe('second');
    db.close();
  });
});
