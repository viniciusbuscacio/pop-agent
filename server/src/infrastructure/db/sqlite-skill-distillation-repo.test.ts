import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { migrate } from './migrate.js';
import { SqliteDistillationRepo, SqliteSkillRevisionsRepo } from './sqlite-skill-distillation-repo.js';

let db: Database.Database;
let marks: SqliteDistillationRepo;
let revisions: SqliteSkillRevisionsRepo;

beforeEach(() => {
  db = new Database(':memory:');
  migrate(db);
  marks = new SqliteDistillationRepo(db);
  revisions = new SqliteSkillRevisionsRepo(db);
});

describe('SqliteDistillationRepo', () => {
  it('remembers how far it read', () => {
    marks.set('chat-1', 'msg-9', '2026-08-07T18:00:00.000Z');
    expect(marks.get('chat-1')).toEqual({
      chatId: 'chat-1',
      messageId: 'msg-9',
      at: '2026-08-07T18:00:00.000Z',
    });
  });

  it('moves the mark forward rather than adding a second one', () => {
    marks.set('chat-1', 'msg-9', '2026-08-07T18:00:00.000Z');
    marks.set('chat-1', 'msg-20', '2026-08-07T19:00:00.000Z');

    expect(marks.get('chat-1')?.messageId).toBe('msg-20');
  });

  it('has no mark for a conversation it never read', () => {
    expect(marks.get('chat-nothing')).toBeUndefined();
  });

  it('answers the status line with the newest round', () => {
    expect(marks.lastRunAt()).toBeUndefined();
    marks.set('chat-1', 'm1', '2026-08-07T18:00:00.000Z');
    marks.set('chat-2', 'm2', '2026-08-07T20:00:00.000Z');

    expect(marks.lastRunAt()).toBe('2026-08-07T20:00:00.000Z');
  });

  it('forgets the conversations that are gone', () => {
    marks.set('alive', 'm1', '2026-08-07T18:00:00.000Z');
    marks.set('deleted', 'm2', '2026-08-07T18:00:00.000Z');
    marks.keepOnly(['alive']);

    expect(marks.get('alive')).toBeDefined();
    expect(marks.get('deleted')).toBeUndefined();
  });

  it('forgets everything when every conversation is gone', () => {
    marks.set('one', 'm1', '2026-08-07T18:00:00.000Z');
    marks.keepOnly([]);

    expect(marks.get('one')).toBeUndefined();
  });
});

describe('SqliteSkillRevisionsRepo', () => {
  const revision = {
    slug: 'deploy',
    name: 'Deploy',
    description: 'How to deploy',
    whenToUse: 'deploying',
    body: 'Push to main.',
    createdAt: '2026-08-07T18:00:00.000Z',
    similarity: 0.93,
  };

  it('holds a proposal and gives it back whole', () => {
    revisions.save(revision);
    expect(revisions.get('deploy')).toEqual(revision);
    expect(revisions.all()).toEqual([revision]);
  });

  it('replaces an unreviewed proposal instead of queueing behind it', () => {
    revisions.save(revision);
    revisions.save({ ...revision, body: 'Push to main, then purge the cache.' });

    expect(revisions.all()).toHaveLength(1);
    expect(revisions.get('deploy')?.body).toBe('Push to main, then purge the cache.');
  });

  it('drops one that was answered', () => {
    revisions.save(revision);
    revisions.delete('deploy');

    expect(revisions.get('deploy')).toBeUndefined();
  });

  it('holds a proposal with no measurement behind it', () => {
    // A slug-collision revision may carry no cosine at all (migration 031) --
    // never a placeholder number in the column the dedup bars retune from.
    const unmeasured: Parameters<SqliteSkillRevisionsRepo['save']>[0] = {
      slug: revision.slug,
      name: revision.name,
      description: revision.description,
      whenToUse: revision.whenToUse,
      body: revision.body,
      createdAt: revision.createdAt,
    };
    revisions.save(unmeasured);

    expect(revisions.get('deploy')).toEqual(unmeasured);
    expect(revisions.get('deploy')?.similarity).toBeUndefined();
  });
});
