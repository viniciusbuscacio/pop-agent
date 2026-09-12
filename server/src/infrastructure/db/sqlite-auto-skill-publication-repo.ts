import type {
  AutoSkillPublication,
  AutoSkillPublicationRepo,
} from '../../application/ports/auto-skill-publication-repo.js';
import type { Db } from './types.js';

export class SqliteAutoSkillPublicationRepo implements AutoSkillPublicationRepo {
  constructor(private readonly db: Db) {}

  prepare(operation: AutoSkillPublication): void {
    this.db.prepare(
      `INSERT INTO auto_skill_publications
       (id, slug, action, review_hash, temp_path, destination, backup_path, state, prepared_at, committed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'prepared', ?, NULL)`,
    ).run(
      operation.id,
      operation.slug,
      operation.action,
      operation.reviewHash,
      operation.tempPath,
      operation.destination,
      operation.backupPath ?? null,
      operation.preparedAt,
    );
  }

  commit(id: string, at: string): void {
    this.db.prepare("UPDATE auto_skill_publications SET state = 'committed', committed_at = ? WHERE id = ?").run(at, id);
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM auto_skill_publications WHERE id = ?').run(id);
  }

  open(): AutoSkillPublication[] {
    const rows = this.db.prepare(
      `SELECT id, slug, action, review_hash AS reviewHash, temp_path AS tempPath,
              destination, backup_path AS backupPath, state, prepared_at AS preparedAt,
              committed_at AS committedAt
         FROM auto_skill_publications ORDER BY prepared_at, id`,
    ).all() as Array<AutoSkillPublication & { backupPath: string | null; committedAt: string | null }>;
    return rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      action: row.action,
      reviewHash: row.reviewHash,
      tempPath: row.tempPath,
      destination: row.destination,
      state: row.state,
      preparedAt: row.preparedAt,
      ...(row.backupPath === null ? {} : { backupPath: row.backupPath }),
      ...(row.committedAt === null ? {} : { committedAt: row.committedAt }),
    }));
  }
}
