import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { migrate } from './migrate.js';
import { SqliteSkillUsageRepo } from './sqlite-skill-usage-repo.js';

let db: Database.Database;
let usage: SqliteSkillUsageRepo;

beforeEach(() => {
  db = new Database(':memory:');
  migrate(db);
  usage = new SqliteSkillUsageRepo(db);
});

describe('SqliteSkillUsageRepo', () => {
  it('starts a skill at one use', () => {
    usage.record(['math'], '2026-08-07T18:00:00.000Z');
    expect(usage.all()).toEqual([
      { slug: 'math', useCount: 1, lastUsedAt: '2026-08-07T18:00:00.000Z' },
    ]);
  });

  it('counts up and moves the stamp forward', () => {
    usage.record(['math'], '2026-08-07T18:00:00.000Z');
    usage.record(['math'], '2026-08-07T19:00:00.000Z');
    const [row] = usage.all();
    expect(row?.useCount).toBe(2);
    expect(row?.lastUsedAt).toBe('2026-08-07T19:00:00.000Z');
  });

  it('records every skill of one turn at the same instant', () => {
    usage.record(['math', 'research'], '2026-08-07T18:00:00.000Z');
    expect(usage.all().map((row) => row.slug).sort()).toEqual(['math', 'research']);
    expect(new Set(usage.all().map((row) => row.lastUsedAt)).size).toBe(1);
  });

  it('does nothing for a turn that routed nothing', () => {
    usage.record([], '2026-08-07T18:00:00.000Z');
    expect(usage.all()).toEqual([]);
  });
});
