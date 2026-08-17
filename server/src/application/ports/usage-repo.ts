/**
 * Reading the cost accounting back for the dashboard (docs/specs/Spec-Pop-General.md §14). The rows
 * are written by the run service into `llm_runs`; this aggregates them.
 */

export interface UsageTotals {
  runs: number;
  tokensIn: number;
  tokensOut: number;
  cost: number;
}

export interface UsageByModel {
  model: string;
  runs: number;
  cost: number;
}

export interface UsageByDay {
  /** ISO date (YYYY-MM-DD). */
  day: string;
  cost: number;
}

export interface UsageReport {
  total: UsageTotals;
  byModel: UsageByModel[];
  /** Most recent days first, capped. */
  byDay: UsageByDay[];
}

export interface UsageRepo {
  report(): UsageReport;
}
