import type { LlmRun, LlmRunsRepo } from '../../application/ports/llm-runs-repo.js';
import type { Db } from './types.js';

/** SQLite adapter for {@link LlmRunsRepo}. */
export class SqliteLlmRunsRepo implements LlmRunsRepo {
  constructor(private readonly db: Db) {}

  record(run: LlmRun): void {
    this.db
      .prepare(
        `INSERT INTO llm_runs (id, chat_id, provider, model, tokens_in, tokens_out, cost, created_at, kind)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.id,
        run.chatId,
        run.provider,
        run.model,
        run.tokensIn,
        run.tokensOut,
        run.cost,
        run.createdAt,
        run.kind ?? 'chat',
      );
  }
}
