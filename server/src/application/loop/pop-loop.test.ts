import { describe, expect, it, vi } from 'vitest';
import { runPopLoop, type LoopChildRequest } from './pop-loop.js';

const progress = { status: 'advanced', delivered: 'README updated', remaining: 'Verify owner goal', nextDeliverable: 'Correct README and check exact content' };

const chat = { providerId: 'parent-provider', modelId: 'chat' };
const worker = { providerId: 'parent-provider', modelId: 'service' };
const input = () => ({ task: 'Implement a checked change', chat, worker, signal: new AbortController().signal });
const plan = JSON.stringify({ plan: 'Inspect, implement, test' });
const review = (verdict: string) => JSON.stringify({ verdict, summary: 'Review actual changes', evidence: ['README.md and captured checks'], progress });

describe('Pop Loop workflow', () => {
  it('plans, executes, corrects and approves sequentially using server-owned model pairs', async () => {
    const calls: LoopChildRequest[] = [];
    const answers = [plan, 'done', review('correct'), 'corrected', review('approved')];
    const result = await runPopLoop({ child: async (request) => { calls.push(request); return answers.shift()!; } }, input());
    expect(result).toMatchObject({ status: 'approved', corrections: 1 });
    expect(calls.map((call) => call.phase)).toEqual(['plan', 'worker', 'review', 'worker', 'review']);
    expect(calls.map((call) => call.model)).toEqual([chat, worker, chat, worker, chat]);
    expect(calls[3]?.prompt).toContain('Review actual changes');
    expect(calls[2]?.prompt).not.toContain('done');
  });
  it('limits corrections to three with no parallel work or automatic retry', async () => {
    const child = vi.fn(async (request: LoopChildRequest) => request.phase === 'plan' ? plan : request.phase === 'worker' ? 'done' : review('correct'));
    expect(await runPopLoop({ child }, input())).toMatchObject({ status: 'limit', corrections: 3 });
    expect(child).toHaveBeenCalledTimes(9);
  });
  it('returns a blocking verdict without corrections', async () => {
    const answers = [plan, 'done', review('blocked')];
    expect(await runPopLoop({ child: async () => answers.shift()! }, input())).toMatchObject({ status: 'blocked', corrections: 0 });
  });
  it.each(['not json', '{"verdict":"approved"}', review('unknown')])('fails closed on malformed review %s', async (bad) => {
    const answers = [plan, 'done', bad];
    const child = vi.fn(async () => answers.shift()!);
    expect(await runPopLoop({ child }, input())).toMatchObject({ status: 'failed' });
    expect(child).toHaveBeenCalledTimes(3);
  });
  it('does not replay a failed write', async () => {
    const child = vi.fn(async (request: LoopChildRequest) => { if (request.phase === 'plan') return plan; throw new Error('write failed'); });
    expect(await runPopLoop({ child }, input())).toMatchObject({ status: 'failed' });
    expect(child).toHaveBeenCalledTimes(2);
  });
  it('cancels before launch and between roles', async () => {
    const controller = new AbortController();
    const child = vi.fn(async () => { controller.abort(); return plan; });
    const request = { ...input(), signal: controller.signal };
    expect(await runPopLoop({ child }, request)).toMatchObject({ status: 'cancelled' });
    expect(child).toHaveBeenCalledOnce();
    child.mockClear();
    expect(await runPopLoop({ child }, request)).toMatchObject({ status: 'cancelled' });
    expect(child).not.toHaveBeenCalled();
  });
  it.each(['plan', 'review'])('distinguishes malformed %s output', async (phase) => {
    const child = async (request: LoopChildRequest) => request.phase === phase ? 'not json' : request.phase === 'plan' ? plan : 'done';
    expect(await runPopLoop({ child }, input())).toMatchObject({ status: 'failed', failure: { phase, code: `invalid_${phase}` } });
  });
  it('requires structured progress, retains a prior verdict on later provider failure, and bounds the next deliverable', async () => {
    const calls: LoopChildRequest[] = [];
    const child = async (request: LoopChildRequest) => {
      calls.push(request);
      if (request.phase === 'plan') return plan;
      if (request.phase === 'review') return JSON.stringify({ verdict: 'correct', summary: 'Still incomplete', evidence: ['captured evidence'],
        progress: { status: 'no-progress', delivered: 'none', remaining: 'Original owner goal', nextDeliverable: 'Change one file and verify its exact contents' } });
      if (request.round === 2) throw new Error('secret from provider');
      return 'done';
    };
    const result = await runPopLoop({ child }, input());
    expect(result).toMatchObject({ status: 'failed', corrections: 1, evidence: ['captured evidence'],
      failure: { phase: 'worker', code: 'provider_failed' }, reviews: [{ verdict: 'correct', progress: { status: 'no-progress' } }] });
    expect(JSON.stringify(result)).not.toContain('secret from provider');
    expect(calls.at(-1)?.prompt).toContain('Change one file and verify its exact contents');
    expect(calls.at(-1)?.prompt).toContain('Passing tests alone does not complete the owner goal');
    expect(calls.at(-1)?.prompt).toContain(input().task);
    const answers = [plan, 'done', JSON.stringify({ verdict: 'approved', summary: 'Tests passed', evidence: ['tests'] })];
    expect(await runPopLoop({ child: async () => answers.shift()! }, input())).toMatchObject({ failure: { code: 'invalid_review' } });
  });

});
