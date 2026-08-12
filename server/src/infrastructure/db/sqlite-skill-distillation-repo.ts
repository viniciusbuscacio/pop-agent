import type {
  DistillationRepo,
  DistillationAttempt,
  DistillationResult,
  FinishDistillationAttempt,
  StartDistillationAttempt,
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

  startAttempt(attempt: StartDistillationAttempt): void {
    this.db
      .prepare(
        `INSERT INTO skill_distillation_attempts
           (id, chat_id, chat_title, from_message_id, through_message_id, trigger,
            requested, state, retry_of, started_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        attempt.id,
        attempt.chatId,
        attempt.chatTitle,
        attempt.fromMessageId ?? null,
        attempt.throughMessageId,
        attempt.trigger,
        attempt.requested ? 1 : 0,
        attempt.state ?? 'running',
        attempt.retryOf ?? null,
        attempt.startedAt,
      );
  }

  finishAttempt(id: string, finish: FinishDistillationAttempt): void {
    const saveResult = this.db.prepare(
      `INSERT INTO skill_distillation_results
         (attempt_id, position, slug, disposition, target_slug, reason, similarity, overlap,
          policy_reasons_json, review_reasons_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM skill_distillation_results WHERE attempt_id = ?').run(id);
      for (const [position, result] of (finish.results ?? []).entries()) {
        saveResult.run(
          id,
          position,
          result.slug,
          result.disposition,
          result.targetSlug ?? null,
          result.reason ?? null,
          result.similarity ?? null,
          result.overlap ?? null,
          JSON.stringify(result.policyReasons ?? []),
          JSON.stringify(result.reviewReasons ?? []),
        );
      }
      this.db
        .prepare(
          `UPDATE skill_distillation_attempts
              SET state = ?, outcome = ?, risk_level = ?, warnings_json = ?,
                  error_code = ?, error_message = ?, finished_at = ?
            WHERE id = ?`,
        )
        .run(
          finish.state,
          finish.outcome,
          finish.riskLevel ?? null,
          JSON.stringify(finish.warnings ?? []),
          finish.errorCode ?? null,
          finish.errorMessage ?? null,
          finish.finishedAt,
          id,
        );
    })();
  }

  attempt(id: string): DistillationAttempt | undefined {
    const row = this.db.prepare(`${ATTEMPT_SELECT} WHERE id = ?`).get(id) as AttemptRow | undefined;
    return row === undefined ? undefined : this.toAttempt(row);
  }

  attempts(limit: number): DistillationAttempt[] {
    const safe = Math.min(Math.max(limit, 1), 100);
    return (this.db
      .prepare(`${ATTEMPT_SELECT} ORDER BY started_at DESC, id DESC LIMIT ?`)
      .all(safe) as AttemptRow[]).map((row) => this.toAttempt(row));
  }

  nextQueuedAttempt(): DistillationAttempt | undefined {
    const row = this.db
      .prepare(`${ATTEMPT_SELECT} WHERE state = 'queued' ORDER BY started_at, id LIMIT 1`)
      .get() as AttemptRow | undefined;
    return row === undefined ? undefined : this.toAttempt(row);
  }

  markAttemptRunning(id: string, at: string): void {
    this.db
      .prepare("UPDATE skill_distillation_attempts SET state = 'running', started_at = ? WHERE id = ? AND state = 'queued'")
      .run(at, id);
  }

  queueRetry(sourceId: string, id: string, at: string): DistillationAttempt | undefined {
    const source = this.attempt(sourceId);
    if (source === undefined || !isRetryable(source)) return undefined;
    const duplicate = this.db
      .prepare("SELECT id FROM skill_distillation_attempts WHERE retry_of = ? AND state IN ('queued', 'running') LIMIT 1")
      .get(sourceId) as { id: string } | undefined;
    if (duplicate !== undefined) return this.attempt(duplicate.id);
    this.startAttempt({
      id,
      chatId: source.chatId,
      chatTitle: source.chatTitle,
      ...(source.fromMessageId === undefined ? {} : { fromMessageId: source.fromMessageId }),
      throughMessageId: source.throughMessageId,
      trigger: 'manual_retry',
      requested: source.requested,
      state: 'queued',
      retryOf: source.id,
      startedAt: at,
    });
    return this.attempt(id);
  }

  private toAttempt(row: AttemptRow): DistillationAttempt {
    const results = this.db
      .prepare(
        `SELECT slug, disposition, target_slug AS targetSlug, reason, similarity, overlap,
                policy_reasons_json AS policyReasonsJson, review_reasons_json AS reviewReasonsJson
           FROM skill_distillation_results WHERE attempt_id = ? ORDER BY position`,
      )
      .all(row.id) as ResultRow[];
    return {
      id: row.id,
      chatId: row.chatId,
      chatTitle: row.chatTitle,
      ...(row.fromMessageId === null ? {} : { fromMessageId: row.fromMessageId }),
      throughMessageId: row.throughMessageId,
      trigger: row.trigger,
      requested: row.requested === 1,
      state: row.state,
      ...(row.outcome === null ? {} : { outcome: row.outcome }),
      ...(row.riskLevel === null ? {} : { riskLevel: row.riskLevel }),
      warnings: readWarnings(row.warningsJson),
      ...(row.errorCode === null ? {} : { errorCode: row.errorCode }),
      ...(row.errorMessage === null ? {} : { errorMessage: row.errorMessage }),
      ...(row.retryOf === null ? {} : { retryOf: row.retryOf }),
      startedAt: row.startedAt,
      ...(row.finishedAt === null ? {} : { finishedAt: row.finishedAt }),
      results: results.map(toResult),
    };
  }
}

const ATTEMPT_SELECT = `SELECT id, chat_id AS chatId, chat_title AS chatTitle,
  from_message_id AS fromMessageId, through_message_id AS throughMessageId,
  trigger, requested, state, outcome, risk_level AS riskLevel,
  warnings_json AS warningsJson, error_code AS errorCode, error_message AS errorMessage,
  retry_of AS retryOf, started_at AS startedAt, finished_at AS finishedAt
  FROM skill_distillation_attempts`;

interface AttemptRow {
  id: string;
  chatId: string;
  chatTitle: string;
  fromMessageId: string | null;
  throughMessageId: string;
  trigger: DistillationAttempt['trigger'];
  requested: 0 | 1;
  state: DistillationAttempt['state'];
  outcome: NonNullable<DistillationAttempt['outcome']> | null;
  riskLevel: NonNullable<DistillationAttempt['riskLevel']> | null;
  warningsJson: string;
  errorCode: string | null;
  errorMessage: string | null;
  retryOf: string | null;
  startedAt: string;
  finishedAt: string | null;
}

type ResultRow = DistillationResult & {
  targetSlug: string | null;
  reason: DistillationResult['reason'] | null;
  similarity: number | null;
  overlap: number | null;
  policyReasonsJson: string;
  reviewReasonsJson: string;
};

function toResult(row: ResultRow): DistillationResult {
  return {
    slug: row.slug,
    disposition: row.disposition,
    ...(row.targetSlug === null ? {} : { targetSlug: row.targetSlug }),
    ...(row.reason === null ? {} : { reason: row.reason }),
    ...(row.similarity === null ? {} : { similarity: row.similarity }),
    ...(row.overlap === null ? {} : { overlap: row.overlap }),
    policyReasons: readWarnings(row.policyReasonsJson),
    reviewReasons: readWarnings(row.reviewReasonsJson),
  };
}

function readWarnings(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

function isRetryable(attempt: DistillationAttempt): boolean {
  return attempt.state === 'failed' || attempt.outcome === 'invalid_output';
}

/** SQLite adapter for {@link SkillRevisionsRepo}. */
export class SqliteSkillRevisionsRepo implements SkillRevisionsRepo {
  constructor(private readonly db: Db) {}

  all(): SkillRevision[] {
    return (this.db.prepare(`${SELECT} ORDER BY created_at`).all() as RevisionRow[]).map(
      toRevision,
    );
  }

  get(slug: string): SkillRevision | undefined {
    const row = this.db.prepare(`${SELECT} WHERE slug = ?`).get(slug) as RevisionRow | undefined;
    return row === undefined ? undefined : toRevision(row);
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
        revision.similarity ?? null,
      );
  }

  delete(slug: string): void {
    this.db.prepare('DELETE FROM skill_revisions WHERE slug = ?').run(slug);
  }
}

// similarity comes back nullable (migration 031): a slug-collision revision
// may carry no measurement, and SQLite reads that as null.
const SELECT =
  'SELECT slug, name, description, when_to_use AS whenToUse, body, created_at AS createdAt, similarity FROM skill_revisions';

type RevisionRow = Omit<SkillRevision, 'similarity'> & { similarity: number | null };

function toRevision(row: RevisionRow): SkillRevision {
  const { similarity, ...rest } = row;
  return { ...rest, ...(similarity === null ? {} : { similarity }) };
}
