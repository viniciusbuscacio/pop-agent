import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CHAT_TITLE, type Chat, type Message } from '../../domain/chat/chat.js';
import { newChatId, newMessageId } from '../../domain/ids.js';
import { migrate } from './migrate.js';
import { SqliteChatRepo } from './sqlite-chat-repo.js';

let db: Database.Database;
let repo: SqliteChatRepo;

const T0 = '2026-07-30T20:00:00.000Z';

function chat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: newChatId(),
    title: DEFAULT_CHAT_TITLE,
    model: '',
    archived: false,
    piSessionId: '',
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

function message(chatId: string, overrides: Partial<Message> = {}): Message {
  return {
    id: newMessageId(),
    chatId,
    role: 'user',
    content: 'hello',
    thinking: '',
    tools: [],
    attachments: [],
    createdAt: T0,
    ...overrides,
  };
}

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  repo = new SqliteChatRepo(db);
});

describe('chats', () => {
  it('round-trips a chat', () => {
    const created = repo.create(chat({ title: 'Groceries', model: 'fake/model-1' }));

    expect(repo.get(created.id)).toEqual(created);
  });

  it('returns undefined for a chat that does not exist', () => {
    expect(repo.get('chat-000000000000')).toBeUndefined();
  });

  it('lists the most recently active first', () => {
    const older = repo.create(chat({ updatedAt: '2026-07-30T10:00:00.000Z' }));
    const newer = repo.create(chat({ updatedAt: '2026-07-30T18:00:00.000Z' }));

    expect(repo.list({ archived: false }).map((row) => row.id)).toEqual([newer.id, older.id]);
  });

  it('keeps archived chats out of the main list', () => {
    const open = repo.create(chat());
    const filed = repo.create(chat());
    repo.setArchived(filed.id, true);

    expect(repo.list({ archived: false }).map((row) => row.id)).toEqual([open.id]);
    expect(repo.list({ archived: true }).map((row) => row.id)).toEqual([filed.id]);
  });

  it('shows the last message as the preview', () => {
    const created = repo.create(chat());
    repo.appendMessage(message(created.id, { content: 'first', createdAt: T0 }));
    repo.appendMessage(
      message(created.id, { content: 'the latest thing', createdAt: '2026-07-30T20:05:00.000Z' }),
    );

    expect(repo.list({ archived: false })[0]?.preview).toBe('the latest thing');
  });

  it('previews an empty chat as an empty string, not null', () => {
    repo.create(chat());

    expect(repo.list({ archived: false })[0]?.preview).toBe('');
  });

  it('renames, re-models and touches', () => {
    const created = repo.create(chat());

    repo.rename(created.id, 'Renamed');
    repo.setModel(created.id, 'fake/model-2');
    repo.touch(created.id, '2026-07-31T00:00:00.000Z');

    const stored = repo.get(created.id);
    expect(stored?.title).toBe('Renamed');
    expect(stored?.model).toBe('fake/model-2');
    expect(stored?.updatedAt).toBe('2026-07-31T00:00:00.000Z');
  });

  it('takes its messages with it when deleted', () => {
    const created = repo.create(chat());
    repo.appendMessage(message(created.id));
    repo.appendMessage(message(created.id));

    repo.delete(created.id);

    expect(repo.get(created.id)).toBeUndefined();
    expect(repo.countMessages(created.id)).toBe(0);
  });

  it('lists titles so a generated one can be de-duplicated', () => {
    repo.create(chat({ title: 'Groceries' }));
    repo.create(chat({ title: 'Taxes' }));

    expect(repo.titles().sort()).toEqual(['Groceries', 'Taxes']);
  });
});

describe('messages', () => {
  it('round-trips content, thinking and tool records', () => {
    const created = repo.create(chat());
    const stored = repo.appendMessage(
      message(created.id, {
        role: 'assistant',
        content: 'the answer',
        thinking: 'let me see',
        tools: [{ name: 'bash', status: 'done', detail: 'echo hello' }],
      }),
    );

    expect(repo.getMessages(created.id, { limit: 10 })).toEqual([stored]);
  });

  it('returns history oldest-first', () => {
    const created = repo.create(chat());
    repo.appendMessage(message(created.id, { content: 'one', createdAt: '2026-07-30T20:00:00.000Z' }));
    repo.appendMessage(message(created.id, { content: 'two', createdAt: '2026-07-30T20:01:00.000Z' }));
    repo.appendMessage(
      message(created.id, { content: 'three', createdAt: '2026-07-30T20:02:00.000Z' }),
    );

    expect(repo.getMessages(created.id, { limit: 10 }).map((row) => row.content)).toEqual([
      'one',
      'two',
      'three',
    ]);
  });

  it('opens a long chat at its tail, not at its beginning', () => {
    const created = repo.create(chat());
    for (let i = 0; i < 10; i += 1) {
      repo.appendMessage(
        message(created.id, {
          content: `message ${String(i)}`,
          createdAt: `2026-07-30T20:${String(i).padStart(2, '0')}:00.000Z`,
        }),
      );
    }

    const page = repo.getMessages(created.id, { limit: 3 });

    expect(page.map((row) => row.content)).toEqual(['message 7', 'message 8', 'message 9']);
  });

  it('pages backwards from a known message without repeating it', () => {
    const created = repo.create(chat());
    for (let i = 0; i < 6; i += 1) {
      repo.appendMessage(
        message(created.id, {
          content: `message ${String(i)}`,
          createdAt: `2026-07-30T20:0${String(i)}:00.000Z`,
        }),
      );
    }

    const tail = repo.getMessages(created.id, { limit: 2 });
    const first = tail[0];
    expect(first).toBeDefined();

    const previous = repo.getMessages(created.id, { limit: 2, before: (first as Message).id });

    expect(previous.map((row) => row.content)).toEqual(['message 2', 'message 3']);
  });

  it('keeps chats apart', () => {
    const mine = repo.create(chat());
    const theirs = repo.create(chat());
    repo.appendMessage(message(mine.id, { content: 'mine' }));
    repo.appendMessage(message(theirs.id, { content: 'theirs' }));

    expect(repo.getMessages(mine.id, { limit: 10 }).map((row) => row.content)).toEqual(['mine']);
  });

  it('survives a corrupt tools column instead of failing the whole read', () => {
    const created = repo.create(chat());
    const stored = repo.appendMessage(message(created.id, { role: 'assistant' }));
    db.prepare('UPDATE messages SET tools_json = ? WHERE id = ?').run('not json', stored.id);

    expect(repo.getMessages(created.id, { limit: 10 })[0]?.tools).toEqual([]);
  });

  it('refuses a message pointing at no chat', () => {
    expect(() => repo.appendMessage(message('chat-000000000000'))).toThrow();
  });
});
