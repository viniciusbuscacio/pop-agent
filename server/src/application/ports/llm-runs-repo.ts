/**
 * Persistence port for cost accounting (popy.spec §6, §14). Write-only in
 * v0.1: rows accumulate now, the dashboard that reads them arrives in v0.2.
 */

export interface LlmRun {
  /**
   * The run id -- one row per billed attempt. A failover attempt (popy.spec
   * §15, fase 2) books its own row under `<runId>-f<n>`, because a failed
   * attempt that reached the model was still paid for.
   */
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
