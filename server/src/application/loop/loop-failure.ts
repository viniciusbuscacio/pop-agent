import type { LoopPhase, LoopResult } from './pop-loop.js';

export type LoopFailurePhase = LoopPhase | 'prepare' | 'artifact' | 'cleanup';
const reasons = {
  snapshot_failed: 'Loop evidence snapshot failed; parent inspection is required.',
  patch_limit: 'Loop patch exceeds the 16 MiB handoff limit; parent inspection is required.',
  read_failed: 'Loop read-only evidence could not be read.',
  invalid_inspection: 'Loop inspection arguments are invalid.',
  provider_failed: 'Loop child provider failed; no automatic retry was attempted.',
  invalid_plan: 'Loop planner returned an invalid plan.',
  invalid_review: 'Loop reviewer returned an invalid review.',
  invalid_worker: 'Loop worker returned an invalid response.',
  missing_evidence: 'Loop review did not inspect all snapshot evidence and actual files.',
  tool_budget: 'Loop stopped at its attempted tool-call budget.',
  deadline: 'Loop execution deadline reached; partial work is handed off without replay.',
  aborted: 'Loop stopped; partial work is handed off without replay.',
  preparation_failed: 'Loop preparation failed. Check repository and Chat/Service Model Settings.',
  artifact_failed: 'Loop artifact capture failed; do not treat this run as approved.',
  cleanup_failed: 'Loop worktree cleanup failed; inspect the private handoff and remove the worktree manually.',
} as const;
export type LoopFailureCode = keyof typeof reasons;
export interface LoopFailure { code: LoopFailureCode; phase: LoopFailurePhase; reason: string }

/** Only application-owned constant messages cross the tool boundary, never external errors. */
export class LoopError extends Error {
  constructor(readonly code: LoopFailureCode, readonly phase: LoopFailurePhase) { super(reasons[code]); }
}
export function failLoop(result: LoopResult, error: unknown, phase: LoopFailurePhase, fallback: LoopFailureCode): LoopResult {
  const failure = error instanceof LoopError ? error : new LoopError(fallback, phase);
  return { ...result, status: failure.code === 'aborted' || failure.code === 'deadline' ? 'cancelled' : 'failed',
    summary: failure.message, failure: { code: failure.code, phase: failure.phase, reason: failure.message } };
}
export function loopAbort(signal: AbortSignal, phase: LoopFailurePhase): LoopError {
  return new LoopError(signal.reason instanceof LoopError && signal.reason.code === 'deadline' ? 'deadline' : 'aborted', phase);
}
