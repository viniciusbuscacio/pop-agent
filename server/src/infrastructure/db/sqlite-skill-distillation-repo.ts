import type {
  DistillationRepo,
  SkillRevision,
  SkillRevisionsRepo,
  Watermark,
} from '../../application/ports/skill-distillation-repo.js';
import type { Db } from './types.js';

/** SQLite adapter for {@link DistillationRepo}. */
export class SqliteDistillationRepo implements DistillationRepo {
  constructor(private readonly db: Db) {}

  get(chatId: string): Watermark | undefined {
    const row = this.db
      .prepare(
        'SELECT chat_id AS chatId, message_id AS messageId, distilled_at AS at FROM skill_distillation WHERE chat_id = ?',
      )
      .get(chatId) as Watermark | undefined;
    return row;
  }

  set(chatId: string, messageId: string, at: string): void {
    this.db
      .prepare(
        `INSERT INTO skill_distillation (chat_id, message_id, distilled_at) VALUES (?, ?, ?)
         ON CONFLICT(chat_id) DO UPDATE SET message_id = excluded.message_id, distilled_at = excluded.distilled_at`,
      )
      .run(chatId, messageId, at);
  }

  lastRunAt(): string | undefined {
    const row = this.db.prepare('SELECT MAX(distilled_at) AS at FROM skill_distillation').get() as
      | { at: string | null }
      | undefined;
    return row?.at ?? undefined;
  }

  keepOnly(chatIds: readonly string[]): void {
    if (chatIds.length === 0) {
      this.db.prepare('DELETE FROM skill_distillation').run();
      return;
    }
    const live = new Set(chatIds);
    const rows = this.db.prepare('SELECT chat_id AS chatId FROM skill_distillation').all() as {
      chatId: string;
    }[];
    const gone = rows.filter((row) => !live.has(row.chatId));
    if (gone.length === 0) return;
    const statement = this.db.prepare('DELETE FROM skill_distillation WHERE chat_id = ?');
    this.db.transaction(() => {
      for (const row of gone) statement.run(row.chatId);
    })();
  }
}

/** SQLite adapter for {@link SkillRevisionsRepo}. */
export class SqliteSkillRevisionsRepo implements SkillRevisionsRepo {
  constructor(private readonly db: Db) {}

  all(): SkillRevision[] {
    return this.db.prepare(`${SELECT} ORDER BY created_at`).all() as SkillRevision[];
  }

  get(slug: string): SkillRevision | undefined {
    return this.db.prepare(`${SELECT} WHERE slug = ?`).get(slug) as SkillRevision | undefined;
  }

  save(revision: SkillRevision): void {
    this.db
      .prepare(
        `INSERT INTO skill_revisions (slug, name, description, when_to_use, body, created_at, similarity)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(slug) DO UPDATE SET
           name = excluded.name,
           description = excluded.description,
           when_to_use = excluded.when_to_use,
           body = excluded.body,
           created_at = excluded.created_at,
           similarity = excluded.similarity`,
      )
      .run(
        revision.slug,
        revision.name,
        revision.description,
        revision.whenToUse,
        revision.body,
        revision.createdAt,
        revision.similarity,
      );
  }

  delete(slug: string): void {
    this.db.prepare('DELETE FROM skill_revisions WHERE slug = ?').run(slug);
  }
}

const SELECT =
  'SELECT slug, name, description, when_to_use AS whenToUse, body, created_at AS createdAt, similarity FROM skill_revisions';
