import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { newChatId, newMessageId } from '../../domain/ids.js';
import { migrate } from './migrate.js';
import { SqliteChatRepo } from './sqlite-chat-repo.js';
import { SqliteMemoryRepo } from './sqlite-memory-repo.js';

let db: Database.Database;
let chats: SqliteChatRepo;
let memory: SqliteMemoryRepo;

function chatWith(title: string, summary = ''): string {
  const id = newChatId();
  chats.create({
    id,
    title,
    model: '',
    provider: '',
    archived: false,
    piSessionId: '',
    summary,
    autoTitle: true,
    createdAt: '2026-07-31T00:00:00.000Z',
    updatedAt: '2026-07-31T00:00:00.000Z',
  });
  return id;
}

function say(chatId: string, role: 'user' | 'assistant', content: string, at: string): void {
  chats.appendMessage({
    id: newMessageId(),
    chatId,
    role,
    content,
    thinking: '',
    tools: [],
    attachments: [],
    createdAt: at,
  });
}

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  chats = new SqliteChatRepo(db);
  memory = new SqliteMemoryRepo(db);
});

describe('SqliteMemoryRepo', () => {
  it('finds a phrase across old conversations, grouped by chat', () => {
    const a = chatWith('Trip planning');
    const b = chatWith('Groceries');
    say(a, 'user', 'we should book the flights to Recife early', '2026-07-30T10:00:00.000Z');
    say(b, 'user', 'buy coffee and milk', '2026-07-30T11:00:00.000Z');

    const hits = memory.search('flights');
    expect(hits).toHaveLength(1);
    expect(hits[0]?.chatId).toBe(a);
    expect(hits[0]?.snippets[0]?.text).toContain('flights');
  });

  it('survives punctuation in the query instead of erroring', () => {
    const a = chatWith('x');
    say(a, 'user', 'the deploy went fine', '2026-07-30T10:00:00.000Z');

    expect(() => memory.search('deploy?! "()"')).not.toThrow();
    expect(memory.search('deploy?! "()"')).toHaveLength(1);
  });

  it('keeps the index in sync when a message is deleted with its chat', () => {
    const a = chatWith('to delete');
    say(a, 'user', 'ephemeral secret plan', '2026-07-30T10:00:00.000Z');
    expect(memory.search('ephemeral')).toHaveLength(1);

    chats.delete(a);
    expect(memory.search('ephemeral')).toHaveLength(0);
  });

  it('lists recent chats with their summaries', () => {
    chatWith('Older', 'about taxes');
    const newer = chatWith('Newer', 'about the trip');
    chats.touch(newer, '2026-07-31T12:00:00.000Z');

    const recent = memory.recentChats(10);
    expect(recent[0]?.title).toBe('Newer');
    expect(recent[0]?.summary).toBe('about the trip');
  });

  it('returns a chat transcript in order', () => {
    const a = chatWith('chat');
    say(a, 'user', 'first', '2026-07-30T10:00:00.000Z');
    say(a, 'assistant', 'second', '2026-07-30T10:00:01.000Z');

    const lines = memory.transcript(a, 10);
    expect(lines.map((line) => line.content)).toEqual(['first', 'second']);
  });
});
