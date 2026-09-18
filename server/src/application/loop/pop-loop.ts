import { failLoop, LoopError, loopAbort, type LoopFailure } from './loop-failure.js';

/** Loop is a bounded workflow, not an additional agent identity. */
export interface LoopModel { providerId: string; modelId: string }
export type LoopPhase = 'plan' | 'worker' | 'review';
export interface LoopChildRequest {
  phase: LoopPhase;
  model: LoopModel;
  prompt: string;
  signal: AbortSignal;
  round?: number;
}
export interface LoopPorts {
  child(request: LoopChildRequest): Promise<string>;
}
export interface LoopResult {
  status: 'approved' | 'blocked' | 'limit' | 'failed' | 'cancelled';
  summary: string;
  corrections: number;
  evidence: string[];
  failure?: LoopFailure;
  reviews?: LoopReview[];
}

export interface LoopReview {
  round: number; verdict: 'approved' | 'correct' | 'blocked'; summary: string; evidence: string[];
  progress: { status: 'advanced' | 'no-progress'; delivered: string; remaining: string; nextDeliverable: string };
}

function object(text: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid child response');
  return parsed as Record<string, unknown>;
}
function boundedText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 32_000;
}

/** Models are server-resolved once per invocation. No model-supplied overrides or retries. */
export async function runPopLoop(
  ports: LoopPorts,
  input: { task: string; chat: LoopModel; worker: LoopModel; signal: AbortSignal },
): Promise<LoopResult> {
  let corrections = 0;
  let phase: LoopPhase = 'plan';
  const reviews: LoopReview[] = [];
  try {
    const call = async (nextPhase: LoopPhase, prompt: string): Promise<string> => {
      phase = nextPhase;
      if (input.signal.aborted) throw loopAbort(input.signal, phase);
      const answer = await ports.child({ phase, round: phase === 'plan' ? 0 : corrections + 1, prompt, model: phase === 'worker' ? input.worker : input.chat, signal: input.signal });
      if (input.signal.aborted) throw loopAbort(input.signal, phase);
      return answer;
    };
    const plannedText = await call('plan', `Owner task:\n${input.task}\nInspect the repository. Return JSON only: {"plan":"bounded implementation and validation plan"}.`);
    let planned: Record<string, unknown>;
    try { planned = object(plannedText); } catch { throw new LoopError('invalid_plan', 'plan'); }
    if (!boundedText(planned.plan)) throw new LoopError('invalid_plan', 'plan');
    let instruction = planned.plan;
    for (;;) {
      await call('worker', `Owner task:\n${input.task}\nApproved workflow plan:\n${planned.plan}\nCurrent instructions:\n${instruction}\nImplement only the next bounded, measurable deliverable toward the original owner goal in this worktree, run relevant checks, and report delivered work, remaining work and explicit no-progress if applicable. Passing tests alone does not complete the owner goal. Do not take outside-scope actions. Do not commit, publish, activate, or delegate. Previous corrections are already present.`);
      const reviewText = await call('review', `Owner task:\n${input.task}\nPlan:\n${planned.plan}\nInspect actual files, diff and captured tool/test evidence with loop_inspect and loop_read. Never approve from worker prose alone. Return JSON only: {"verdict":"approved|correct|blocked","summary":"findings or precise corrections","evidence":["inspected paths and test outcomes"],"progress":{"status":"advanced|no-progress","delivered":"measurable work this round or none","remaining":"original goal still unmet or none","nextDeliverable":"one bounded measurable next deliverable with acceptance check, or none"}}. Read overview and paginate every diff, inventory and worker evidence section to completion. Missing or truncated validation must not be approved. Passing the test suite is not a substitute for the original goal. Approve only verifiable completion of the original task; otherwise correct with a bounded next deliverable or block.`);
      let review: Record<string, unknown>;
      try { review = object(reviewText); } catch { throw new LoopError('invalid_review', 'review'); }
      const progress = review.progress as Record<string, unknown> | undefined;
      if (!['approved', 'correct', 'blocked'].includes(String(review.verdict)) || !boundedText(review.summary) ||
          !Array.isArray(review.evidence) || review.evidence.length < 1 || review.evidence.length > 30 || !review.evidence.every(boundedText) || !progress ||
          !['advanced', 'no-progress'].includes(String(progress.status)) ||
          ![progress.delivered, progress.remaining, progress.nextDeliverable].every(boundedText)) {
        throw new LoopError('invalid_review', 'review');
      }
      reviews.push({ round: corrections + 1, verdict: review.verdict as LoopReview['verdict'], summary: review.summary,
        evidence: review.evidence as string[], progress: { status: progress.status as 'advanced' | 'no-progress',
          delivered: progress.delivered as string, remaining: progress.remaining as string, nextDeliverable: progress.nextDeliverable as string } });
      if (review.verdict !== 'correct') return { status: review.verdict as 'approved' | 'blocked', summary: review.summary, evidence: review.evidence as string[], corrections, reviews };
      if (corrections === 3) return { status: 'limit', summary: review.summary, evidence: review.evidence as string[], corrections, reviews };
      corrections += 1;
      instruction = `${review.summary}\nNext bounded deliverable: ${String(progress.nextDeliverable)}\nRemaining original goal: ${String(progress.remaining)}`;
    }
  } catch (error) {
    return failLoop({ status: 'failed', summary: '', evidence: reviews.at(-1)?.evidence ?? [], corrections, reviews },
      input.signal.aborted ? loopAbort(input.signal, phase) : error, phase, 'provider_failed');
  }
}
