import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { migrate } from './migrate.js';
import { SqliteLlmRunsRepo } from './sqlite-llm-runs-repo.js';

let db: Database.Database;
let repo: SqliteLlmRunsRepo;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  repo = new SqliteLlmRunsRepo(db);
});

describe('SqliteLlmRunsRepo', () => {
  it('defaults kind to chat', () => {
    repo.record({
      id: 'run-abc',
      chatId: 'chat-abc',
      provider: 'p',
      model: 'm',
      tokensIn: 1,
      tokensOut: 2,
      cost: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    const row = db.prepare('SELECT kind FROM llm_runs WHERE id = ?').get('run-abc') as {
      kind: string;
    };
    expect(row.kind).toBe('chat');
  });

  it('stores service rows with an empty chat id', () => {
    repo.record({
      id: 'svc-title-1',
      chatId: '',
      provider: 'openrouter',
      model: 'm',
      tokensIn: 10,
      tokensOut: 5,
      cost: 0.01,
      createdAt: '2026-01-01T00:00:00.000Z',
      kind: 'service',
    });

    const row = db
      .prepare('SELECT chat_id, kind FROM llm_runs WHERE id = ?')
      .get('svc-title-1') as { chat_id: string; kind: string };
    expect(row).toEqual({ chat_id: '', kind: 'service' });
  });
});
