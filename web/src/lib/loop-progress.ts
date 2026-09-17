import type { ToolCallDTO } from '@pop-agent/shared';

export type LoopStage = 'plan' | 'worker' | 'review';
export type LoopStageState = 'pending' | 'active' | 'completed' | 'error' | 'interrupted' | 'unknown';
type LoopOutcome = 'approved' | 'blocked' | 'limit' | 'failed' | 'cancelled';
interface LoopResult {
  status: LoopOutcome;
  summary: string;
  corrections: number;
  evidence: string[];
}

function object(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text);
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown> : undefined;
  } catch { return undefined; }
}

/** Only recognize the tool's own bounded phase grammar and explicit final result.
 * Never scan arbitrary task/evidence prose for words like "approved" or "worker".
 * Both old concatenated markers and current newline snapshots remain readable.
 */
export function loopProgress(tool: ToolCallDTO, interrupted: boolean) {
  let rest = tool.detail.trim();
  const firstNewline = rest.indexOf('\n');
  if (firstNewline >= 0) {
    const args = object(rest.slice(0, firstNewline));
    if (args && 'repository' in args && 'task' in args && !('status' in args)) {
      rest = rest.slice(firstNewline + 1).trimStart();
    } else if (rest.slice(0, firstNewline).endsWith('…') && rest.startsWith('{')) {
      // RunTranslator caps the argument preview at 400 characters.
      rest = rest.slice(firstNewline + 1).trimStart();
    }
  }
  const stages: Record<LoopStage, LoopStageState> = { plan: 'pending', worker: 'pending', review: 'pending' };
  let phase: LoopStage | undefined;
  let executions = 0;
  let corrections: number | undefined;
  for (let entries = 0; entries < 9; entries += 1) {
    const marker = /^Loop: (plan|worker|review)(?: \(correction ([1-3])\))?(?=Loop: |\r?\n|\{|$)\s*/.exec(rest);
    if (!marker) break;
    phase = marker[1] as LoopStage;
    if (phase === 'worker') {
      executions += 1;
      corrections = marker[2] === undefined ? executions - 1 : Number(marker[2]);
      stages.plan = 'completed'; // Execution starts only after a validated plan.
      stages.review = 'pending';
    }
    if (phase === 'review') {
      stages.plan = 'completed';
      stages.worker = 'completed'; // Phase completion is not business approval.
    }
    stages[phase] = 'active';
    rest = rest.slice(marker[0].length);
  }
  const parsed = object(rest);
  const result: LoopResult | undefined = parsed &&
    ['approved', 'blocked', 'limit', 'failed', 'cancelled'].includes(String(parsed.status)) &&
    typeof parsed.summary === 'string' && parsed.summary.trim().length > 0 && parsed.summary.length <= 32_000 &&
    Number.isInteger(parsed.corrections) && Number(parsed.corrections) >= 0 && Number(parsed.corrections) <= 3 &&
    Array.isArray(parsed.evidence) && parsed.evidence.length <= 30 &&
    (!['approved', 'blocked', 'limit'].includes(String(parsed.status)) || parsed.evidence.length > 0) &&
    parsed.evidence.every((entry) => typeof entry === 'string' && entry.trim().length > 0 && entry.length <= 32_000)
    ? parsed as unknown as LoopResult : undefined;
  const outcome: LoopOutcome | 'unknown' | 'active' = result?.status ?? (tool.status === 'error' ? 'failed' :
    interrupted && tool.status !== 'done' ? 'cancelled' :
    tool.status === 'done' ? 'unknown' : 'active');
  if (result) corrections = result.corrections;
  if (result && ['approved', 'blocked', 'limit'].includes(result.status)) {
    stages.plan = stages.worker = stages.review = 'completed';
  } else if (phase && outcome !== 'active') {
    stages[phase] = outcome === 'cancelled' ? 'interrupted' : outcome === 'failed' ? 'error' : 'unknown';
  }
  return { stages, outcome, corrections, result };
}
