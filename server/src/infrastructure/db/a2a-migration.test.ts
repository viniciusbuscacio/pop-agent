import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { migrate } from './migrate.js';

function tableNames(db: Database.Database): string[] {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[])
    .map((row) => row.name);
}

describe('A2A migration 045', () => {
  it('creates the agent, discovery, and durable task tables', () => {
    const db = new Database(':memory:');
    migrate(db);

    expect(tableNames(db)).toEqual(expect.arrayContaining([
      'a2a_agents', 'a2a_interfaces', 'a2a_skills', 'a2a_tasks',
    ]));
    expect((db.prepare('SELECT version FROM schema_migrations WHERE version = 45').get() as {
      version: number;
    }).version).toBe(45);
    db.close();
  });

  it('constrains persisted task states to the application contract', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    migrate(db);
    db.prepare(`INSERT INTO a2a_agents
      (id,name,base_url,auth_kind,created_at,updated_at) VALUES (?,?,?,?,?,?)`).run(
      'agent', 'Agent', 'https://agent.test', 'none', 'T', 'T',
    );

    expect(() => db.prepare(`INSERT INTO a2a_tasks
      (id,agent_id,remote_task_id,state,request_text,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?)`).run('task', 'agent', 'remote', 'unknown', 'hello', 'T', 'T'))
      .toThrow(/CHECK constraint failed/);
    db.close();
  });
});
