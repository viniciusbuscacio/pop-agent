/**
 * Persistence port for cost accounting (pop-agent.spec §6, §14). Write-only in
 * v0.1: rows accumulate now, the dashboard that reads them arrives in v0.2.
 */

export interface LlmRun {
  /**
   * The run id -- one row per billed attempt. A failover attempt (pop-agent.spec
   * §15, fase 2) books its own row under `<runId>-f<n>`, because a failed
   * attempt that reached the model was still paid for.
   */
  id: string;
  /**
   * The conversation this run served. Empty for {@link kind} `service`: background
   * work belongs to no chat; Usage aggregates by cost/model/period, not by chat.
   */
  chatId: string;
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  /** US dollars, as the provider reported them. */
  cost: number;
  createdAt: string;
  /** Chat runs default to `chat`; titles/summaries/voice cleanup use `service`. */
  kind?: 'chat' | 'service';
  /** Stable service function for diagnostics and cost attribution. */
  purpose?: string;
}

export interface LlmRunsRepo {
  record(run: LlmRun): void;
}
