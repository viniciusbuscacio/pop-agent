import { describe, expect, it, vi } from 'vitest';
import { AgentSession, SessionManager, type ModelRuntime } from '@earendil-works/pi-coding-agent';
import { SdkPiSession } from './sdk-pi-session.js';

function fixture(knownWindow = true) {
  const manager = SessionManager.inMemory();
  const context = { tokens: 1200 as number | null, contextWindow: 32000, percent: 3.75 as number | null };
  const prompt = vi.fn();
  const sdk = {
    sessionId: manager.getSessionId(), sessionFile: '/private/sessions/secret.jsonl',
    sessionManager: manager, model: { provider: 'selected', id: 'next-model' },
    getContextUsage: () => context, prompt,
    getSessionStats: AgentSession.prototype.getSessionStats,
  } as unknown as AgentSession;
  const adapter = new SdkPiSession(sdk, {} as ModelRuntime, { current: undefined }, [], [], false, () => [], () => knownWindow);
  return { adapter, manager, context, prompt };
}

function assistant(manager: SessionManager, cost = 0.125, tokens = 100, responseModel = 'actual-model') {
  return manager.appendMessage({
    role: 'assistant', provider: 'fallback', model: 'requested', responseModel,
    api: 'openai-completions', content: [{ type: 'text', text: 'Answer' }],
    usage: { input: tokens, output: tokens, cacheRead: tokens, cacheWrite: tokens, totalTokens: tokens * 4,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: cost } },
    stopReason: 'stop', timestamp: 1,
  });
}

describe('SDK /info statistics', () => {
  it('reuses SDK all-entry totals while reporting the active branch actual model and SDK context', () => {
    const { adapter, manager, prompt } = fixture();
    manager.appendMessage({ role: 'user', content: 'Question', timestamp: 0 });
    const active = assistant(manager);
    assistant(manager, 0.25, 100, 'other-branch-model');
    manager.branch(active);
    const stats = adapter.stats();
    expect(stats.tokens).toEqual({ input: 200, output: 200, cacheRead: 200, cacheWrite: 200, total: 800 });
    expect(stats.cost).toBe(0.375);
    expect(stats.totalMessages).toBe(3);
    expect(stats.currentModel).toEqual({ providerId: 'selected', modelId: 'next-model' });
    expect(stats.lastUsedModel).toEqual({ providerId: 'fallback', modelId: 'actual-model' });
    expect(stats.infoContext).toEqual({ tokens: 1200, contextWindow: 32000, percent: 3.75 });
    expect(stats.usageStatus).toBe('reported');
    expect(stats.costStatus).toBe('estimated');
    expect(prompt).not.toHaveBeenCalled();
  });

  it('keeps post-compaction context unknown without discarding a known window', () => {
    const { adapter, context } = fixture();
    context.tokens = null;
    context.percent = null;
    expect(adapter.stats().infoContext).toEqual({ tokens: null, contextWindow: 32000, percent: null });
  });

  it('does not expose a synthetic custom-model context window or zero unknown cost', () => {
    const { adapter, manager } = fixture(false);
    assistant(manager, 0);
    expect(adapter.stats()).toMatchObject({
      infoContext: { tokens: 1200, contextWindow: null, percent: null },
      costStatus: 'unavailable', usageStatus: 'reported',
    });
  });

  it('marks missing usage and mixed known/unknown totals honestly', () => {
    const { adapter, manager } = fixture();
    assistant(manager, 0, 0);
    expect(adapter.stats()).toMatchObject({ costStatus: 'unavailable', usageStatus: 'unavailable' });
    assistant(manager);
    expect(adapter.stats()).toMatchObject({ costStatus: 'partial', usageStatus: 'partial' });
  });

  it('handles an empty session without inventing a last-used model', () => {
    const { adapter } = fixture();
    expect(adapter.stats()).toMatchObject({ totalMessages: 0, cost: 0, costStatus: 'estimated', usageStatus: 'reported' });
    expect(adapter.stats().lastUsedModel).toBeUndefined();
  });
});
