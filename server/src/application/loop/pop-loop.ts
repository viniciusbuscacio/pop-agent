/** Loop is a bounded workflow, not an additional agent identity. */
export interface LoopModel { providerId: string; modelId: string }
export type LoopPhase = 'plan' | 'worker' | 'review';
export interface LoopChildRequest {
  phase: LoopPhase;
  model: LoopModel;
  prompt: string;
  signal: AbortSignal;
}
export interface LoopPorts {
  child(request: LoopChildRequest): Promise<string>;
}
export interface LoopResult {
  status: 'approved' | 'blocked' | 'limit' | 'failed' | 'cancelled';
  summary: string;
  corrections: number;
  evidence: string[];
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
  try {
    const call = async (phase: LoopPhase, prompt: string): Promise<string> => {
      input.signal.throwIfAborted();
      const answer = await ports.child({ phase, prompt, model: phase === 'worker' ? input.worker : input.chat, signal: input.signal });
      input.signal.throwIfAborted();
      return answer;
    };
    const planned = object(await call('plan', `Owner task:\n${input.task}\nInspect the repository. Return JSON only: {"plan":"bounded implementation and validation plan"}.`));
    if (!boundedText(planned.plan)) throw new Error('Invalid plan');
    let instruction = planned.plan;
    for (;;) {
      await call('worker', `Owner task:\n${input.task}\nApproved workflow plan:\n${planned.plan}\nCurrent instructions:\n${instruction}\nImplement in this worktree, run checks, and report results. Do not commit, publish, activate, or delegate. Previous corrections are already present.`);
      const review = object(await call('review', `Owner task:\n${input.task}\nPlan:\n${planned.plan}\nInspect actual files, diff and captured tool/test evidence with loop_inspect and loop_read. Never approve from worker prose alone. Return JSON only: {"verdict":"approved|correct|blocked","summary":"findings or precise corrections","evidence":["inspected paths and test outcomes"]}. Missing validation must not be approved.`));
      if (!['approved', 'correct', 'blocked'].includes(String(review.verdict)) || !boundedText(review.summary) ||
          !Array.isArray(review.evidence) || review.evidence.length < 1 || review.evidence.length > 30 || !review.evidence.every(boundedText)) {
        throw new Error('Invalid review');
      }
      if (review.verdict !== 'correct') return { status: review.verdict as 'approved' | 'blocked', summary: review.summary, evidence: review.evidence as string[], corrections };
      if (corrections === 3) return { status: 'limit', summary: review.summary, evidence: review.evidence as string[], corrections };
      corrections += 1;
      instruction = review.summary;
    }
  } catch {
    return { status: input.signal.aborted ? 'cancelled' : 'failed', summary: input.signal.aborted ? 'Loop stopped; partial work is handed off without replay.' : 'Loop child failed or returned malformed output; no automatic retry was attempted.', evidence: [], corrections };
  }
}
