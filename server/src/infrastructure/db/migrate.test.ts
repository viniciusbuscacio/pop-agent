import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { migrate } from './migrate.js';

const dirs: string[] = [];

function migrationsDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'pop-migrations-'));
  dirs.push(dir);
  for (const [name, sql] of Object.entries(files)) writeFileSync(join(dir, name), sql);
  return dir;
}

function tableNames(db: Database.Database): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as { name: string }[];
  return rows.map((row) => row.name);
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('migration runner', () => {
  it('applies pending migrations in numeric order', () => {
    const dir = migrationsDir({
      '001_first.sql': 'CREATE TABLE first (id INTEGER PRIMARY KEY);',
      '002_second.sql': 'CREATE TABLE second (id INTEGER PRIMARY KEY);',
    });
    const db = new Database(':memory:');

    expect(migrate(db, dir)).toBe(2);
    expect(tableNames(db)).toEqual(['first', 'schema_migrations', 'second']);
  });

  it('is idempotent: a second run applies nothing', () => {
    const dir = migrationsDir({ '001_first.sql': 'CREATE TABLE first (id INTEGER PRIMARY KEY);' });
    const db = new Database(':memory:');

    expect(migrate(db, dir)).toBe(1);
    expect(migrate(db, dir)).toBe(0);
  });

  it('applies only the migrations added since the last run', () => {
    const db = new Database(':memory:');
    const first = migrationsDir({ '001_first.sql': 'CREATE TABLE first (id INTEGER PRIMARY KEY);' });
    migrate(db, first);

    const both = migrationsDir({
      '001_first.sql': 'CREATE TABLE first (id INTEGER PRIMARY KEY);',
      '002_second.sql': 'CREATE TABLE second (id INTEGER PRIMARY KEY);',
    });
    expect(migrate(db, both)).toBe(1);
    expect(tableNames(db)).toContain('second');
  });

  it('leaves no partial schema behind when a migration fails', () => {
    const dir = migrationsDir({
      '001_broken.sql': 'CREATE TABLE ok (id INTEGER PRIMARY KEY); THIS IS NOT SQL;',
    });
    const db = new Database(':memory:');

    expect(() => migrate(db, dir)).toThrow();
    expect(tableNames(db)).not.toContain('ok');
  });

  it('rejects a migration name outside NNN_descriptive_name.sql', () => {
    const dir = migrationsDir({ 'settings.sql': 'CREATE TABLE nope (id INTEGER);' });
    expect(() => migrate(new Database(':memory:'), dir)).toThrow(/NNN_descriptive_name\.sql/);
  });

  it('requires zero-padded three-digit versions', () => {
    const dir = migrationsDir({ '01_short.sql': 'CREATE TABLE nope (id INTEGER);' });
    expect(() => migrate(new Database(':memory:'), dir)).toThrow(/NNN_descriptive_name\.sql/);
  });

  it('rejects duplicate versions before either migration changes the database', () => {
    const dir = migrationsDir({
      '001_first.sql': 'CREATE TABLE first (id INTEGER PRIMARY KEY);',
      '001_second.sql': 'CREATE TABLE second (id INTEGER PRIMARY KEY);',
    });
    const db = new Database(':memory:');

    expect(() => migrate(db, dir)).toThrow(/duplicate migration version 1/);
    expect(tableNames(db)).toEqual([]);
  });

  it('ships the real migrations: settings and secrets exist after a default run', () => {
    const db = new Database(':memory:');
    migrate(db);
    expect(tableNames(db)).toEqual(expect.arrayContaining(['settings', 'secrets']));
  });
});
