import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../db/migrate.js';
import { SqliteUserMemoryRepo } from '../db/sqlite-user-memory-repo.js';
import { buildUserMemoryTools, scrubSecrets } from './user-memory-tools.js';

describe('scrubSecrets', () => {
  it('redacts lines that look like a credential', () => {
    const input = 'likes Elixir\napi_key: sk-12345\nprefers dark mode\npassword = hunter2';
    expect(scrubSecrets(input)).toBe(
      'likes Elixir\n[redacted secret]\nprefers dark mode\n[redacted secret]',
    );
  });
});

describe('user memory repo', () => {
  let db: Database.Database;
  let repo: SqliteUserMemoryRepo;

  beforeEach(() => {
    db = new Database(':memory:');
    migrate(db);
    repo = new SqliteUserMemoryRepo(db);
  });

  it('starts empty', () => {
    expect(repo.read().doc).toBe('');
  });

  it('keeps the previous version as a backup on write, and restores it', () => {
    repo.write('first');
    repo.write('second');

    expect(repo.read().doc).toBe('second');
    expect(repo.read().backup).toBe('first');

    repo.restoreBackup();
    expect(repo.read().doc).toBe('first');
  });

  it('scrubs secrets through the update tool', async () => {
    const tools = buildUserMemoryTools((tool) => tool, repo);
    const update = tools.find((tool) => tool.name === 'memory_user_update');

    await update?.execute('id', { content: 'likes tea\ntoken: abc123' }, undefined, undefined, {} as never);

    expect(repo.read().doc).toBe('likes tea\n[redacted secret]');
  });
});
