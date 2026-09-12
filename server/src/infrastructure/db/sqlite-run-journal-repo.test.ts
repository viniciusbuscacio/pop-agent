import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Message } from '../../domain/chat/chat.js';
import type { RunJournalEntry } from '../../application/ports/run-journal-repo.js';
import { openDatabase } from './database.js';
import { SqliteChatRepo } from './sqlite-chat-repo.js';
import { SqliteQueuedMessageRepo } from './sqlite-queued-message-repo.js';
import { SqliteRunJournalRepo } from './sqlite-run-journal-repo.js';

const AT = '2026-08-18T12:00:00.000Z';
const CHAT = {
  id: 'chat-journal-test',
  title: 'Journal test',
  model: '',
  provider: '',
  archived: false,
  pinned: false,
  executionMode: 'normal' as const,
  piSessionId: '',
  summary: '',
  autoTitle: true,
  createdAt: AT,
  updatedAt: AT,
};

function user(): Message {
  return {
    id: 'message-journal-user',
    chatId: CHAT.id,
    role: 'user',
    content: 'survive the crash',
    thinking: '',
    tools: [],
    attachments: [],
    createdAt: AT,
  };
}

function entry(): RunJournalEntry {
  return {
    runId: 'run-journal-test',
    chatId: CHAT.id,
    userMessageId: user().id,
    state: 'queued',
    prompt: 'survive the crash',
    model: 'model',
    provider: 'provider',
    attachments: [],
    notify: true,
    executionMode: 'normal',
    seq: 0,
    content: '',
    thinking: '',
    tools: [],
    createdAt: AT,
    updatedAt: AT,
  };
}

describe('sqlite run journal', () => {
  it('survives DB reopen and settles exactly once', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'pop-run-journal-')), 'pop-agent.db');
    const first = openDatabase(file);
    const chats = new SqliteChatRepo(first);
    chats.create(CHAT);
    new SqliteQueuedMessageRepo(first).create({
      id: 'queued-journal-test',
      chatId: CHAT.id,
      text: user().content,
      deliveryMode: 'follow_up',
      executionMode: 'normal',
      attachments: [],
      filePaths: [],
      createdAt: AT,
      updatedAt: AT,
    });
    const journal = new SqliteRunJournalRepo(first);
    journal.admit(entry(), user(), 'queued-journal-test');
    expect(new SqliteQueuedMessageRepo(first).get(CHAT.id)).toBeUndefined();
    expect(chats.getMessages(CHAT.id, { limit: 10 })).toEqual([user()]);
    expect(journal.markRunning(entry().runId, AT)).toBe(true);
    expect(
      journal.saveProjection(
        entry().runId,
        {
          seq: 2,
          content: 'partial answer',
          thinking: 'partial thought',
          tools: [{ name: 'read', status: 'done', detail: 'file' }],
        },
        AT,
      ),
    ).toBe(true);
    first.close();

    const second = openDatabase(file);
    const reopened = new SqliteRunJournalRepo(second);
    expect(reopened.list()).toEqual([
      expect.objectContaining({
        runId: entry().runId,
        state: 'running',
        seq: 2,
        content: 'partial answer',
        thinking: 'partial thought',
        tools: [{ name: 'read', status: 'done', detail: 'file' }],
      }),
    ]);

    const answer: Message = {
      id: 'message-journal-answer',
      chatId: CHAT.id,
      role: 'assistant',
      content: 'partial answer\n\n*— interrupted by a server restart —*',
      thinking: 'partial thought',
      tools: [{ name: 'read', status: 'done', detail: 'file' }],
      attachments: [],
      createdAt: AT,
    };
    expect(reopened.settle(entry().runId, [answer], AT)).toBe(true);
    expect(reopened.settle(entry().runId, [answer], AT)).toBe(false);
    expect(new SqliteChatRepo(second).getMessages(CHAT.id, { limit: 10 })).toEqual([user(), answer]);
    expect(reopened.list()).toEqual([]);
    second.close();
  });

  it('cascades unfinished runs when their chat is deleted', () => {
    const db = openDatabase(':memory:');
    const chats = new SqliteChatRepo(db);
    chats.create(CHAT);
    const journal = new SqliteRunJournalRepo(db);
    journal.admit(entry(), user());

    chats.delete(CHAT.id);

    expect(journal.list()).toEqual([]);
    db.close();
  });
});
