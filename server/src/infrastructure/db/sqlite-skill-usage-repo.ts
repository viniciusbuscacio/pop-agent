import type { SkillUsage, SkillUsageRepo } from '../../application/ports/skill-usage-repo.js';
import type { Db } from './types.js';

/** SQLite adapter for {@link SkillUsageRepo}. */
export class SqliteSkillUsageRepo implements SkillUsageRepo {
  constructor(private readonly db: Db) {}

  record(slugs: readonly string[], at: string): void {
    if (slugs.length === 0) return;
    const statement = this.db.prepare(
      `INSERT INTO skill_usage (slug, use_count, last_used_at) VALUES (?, 1, ?)
       ON CONFLICT(slug) DO UPDATE SET use_count = use_count + 1, last_used_at = excluded.last_used_at`,
    );
    // One transaction: a turn that routed three skills counted three or none.
    this.db.transaction(() => {
      for (const slug of slugs) statement.run(slug, at);
    })();
  }

  all(): SkillUsage[] {
    const rows = this.db
      .prepare('SELECT slug, use_count AS useCount, last_used_at AS lastUsedAt FROM skill_usage')
      .all() as SkillUsage[];
    return rows;
  }
}
