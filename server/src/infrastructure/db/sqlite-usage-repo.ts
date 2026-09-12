import type {
  UsageByDay,
  UsageByModel,
  UsageReport,
  UsageRepo,
  UsageTotals,
} from '../../application/ports/usage-repo.js';
import type { Db } from './types.js';

/** SQLite adapter for {@link UsageRepo}, aggregating the `llm_runs` table. */
export class SqliteUsageRepo implements UsageRepo {
  constructor(private readonly db: Db) {}

  report(): UsageReport {
    const total = this.db
      .prepare(
        `SELECT count(*) AS runs,
                COALESCE(sum(tokens_in), 0)  AS tokensIn,
                COALESCE(sum(tokens_out), 0) AS tokensOut,
                COALESCE(sum(cost), 0)       AS cost
           FROM llm_runs`,
      )
      .get() as UsageTotals;

    const byModel = this.db
      .prepare(
        `SELECT model, count(*) AS runs, COALESCE(sum(cost), 0) AS cost
           FROM llm_runs
       GROUP BY model
       ORDER BY cost DESC`,
      )
      .all() as UsageByModel[];

    const byDay = this.db
      .prepare(
        `SELECT substr(created_at, 1, 10) AS day, COALESCE(sum(cost), 0) AS cost
           FROM llm_runs
       GROUP BY day
       ORDER BY day DESC
          LIMIT 30`,
      )
      .all() as UsageByDay[];

    return { total, byModel, byDay };
  }
}
