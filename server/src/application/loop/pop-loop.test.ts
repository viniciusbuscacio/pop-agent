import { describe, expect, it, vi } from 'vitest';
import { runPopLoop, type LoopChildRequest } from './pop-loop.js';

const chat = { providerId: 'parent-provider', modelId: 'chat' };
const worker = { providerId: 'parent-provider', modelId: 'service' };
const input = () => ({ task: 'Implement a checked change', chat, worker, signal: new AbortController().signal });
const plan = JSON.stringify({ plan: 'Inspect, implement, test' });
const review = (verdict: string) => JSON.stringify({ verdict, summary: 'Review actual changes', evidence: ['README.md and captured checks'] });

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
});
