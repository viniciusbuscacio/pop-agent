/**
 * Persistence port for cost accounting (popy.spec §6, §14). Write-only in
 * v0.1: rows accumulate now, the dashboard that reads them arrives in v0.2.
 */

export interface LlmRun {
  /** The run id -- one row per run, so a retry cannot double-count. */
  id: string;
  chatId: string;
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  /** US dollars, as the provider reported them. */
  cost: number;
  createdAt: string;
}

export interface LlmRunsRepo {
  record(run: LlmRun): void;
}
