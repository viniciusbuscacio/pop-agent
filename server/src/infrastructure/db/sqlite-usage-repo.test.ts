import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { migrate } from './migrate.js';
import { SqliteUsageRepo } from './sqlite-usage-repo.js';

let db: Database.Database;
let usage: SqliteUsageRepo;

function run(id: string, model: string, tokensIn: number, tokensOut: number, cost: number, at: string): void {
  db.prepare(
    `INSERT INTO llm_runs (id, chat_id, provider, model, tokens_in, tokens_out, cost, created_at)
     VALUES (?, 'chat-x', 'openrouter', ?, ?, ?, ?, ?)`,
  ).run(id, model, tokensIn, tokensOut, cost, at);
}

beforeEach(() => {
  db = new Database(':memory:');
  migrate(db);
  usage = new SqliteUsageRepo(db);
});

describe('SqliteUsageRepo', () => {
  it('is empty before any run', () => {
    expect(usage.report().total).toEqual({ runs: 0, tokensIn: 0, tokensOut: 0, cost: 0 });
  });

  it('totals runs, tokens and cost', () => {
    run('run-1', 'kimi', 100, 20, 0.001, '2026-07-30T10:00:00.000Z');
    run('run-2', 'kimi', 200, 40, 0.002, '2026-07-31T10:00:00.000Z');
    run('run-3', 'gpt', 50, 10, 0.005, '2026-07-31T11:00:00.000Z');

    const report = usage.report();
    expect(report.total).toEqual({ runs: 3, tokensIn: 350, tokensOut: 70, cost: 0.008 });
    expect(report.byModel[0]?.model).toBe('gpt'); // highest cost first
    expect(report.byDay.map((d) => d.day)).toEqual(['2026-07-31', '2026-07-30']);
  });
});
