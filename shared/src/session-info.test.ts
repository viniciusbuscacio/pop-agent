import { describe, expect, it } from 'vitest';
import { formatSessionInfo, type SessionInfoDTO } from './session-info.js';

const info: SessionInfoDTO = {
  chatId: 'chat-123', sessionId: 'session-123', mode: 'plan', scope: 'pi-session',
  selectedModel: { providerId: 'chosen', modelId: 'chosen-model' },
  currentModel: { providerId: 'chosen', modelId: 'chosen-model' },
  lastUsedModel: { providerId: 'fallback', modelId: 'actual-model' },
  context: { tokens: 1234, contextWindow: 64000, percent: 1.928125 },
  messages: { total: 5, user: 2, assistant: 2 }, tools: { calls: 1, results: 1 },
  tokens: { input: 1000, output: 200, cacheRead: 30, cacheWrite: 4, total: 1234 },
  usageStatus: 'reported', cost: 0.123456, costStatus: 'estimated',
};

describe('/info formatting', () => {
  it('shows scoped counters, exact model pairs, context, identifiers and four-decimal estimated cost', () => {
    const text = formatSessionInfo(info);
    for (const expected of ['fallback / actual-model', 'Selected model: chosen / chosen-model',
      '1234 / 64000 tokens (1.9%)', 'not chat lifetime', 'Messages: 5', 'Tokens: 1234',
      'Input: 1000', 'Output: 200', 'Cache read: 30', 'Cache write: 4', '$0.1235',
      'Tools: 1 calls / 1 results', 'Mode: plan', 'Chat ID: chat-123', 'Session ID: session-123']) {
      expect(text).toContain(expected);
    }
  });
  it('preserves unknown values and shows known zero only when provided', () => {
    const text = formatSessionInfo({ ...info, selectedModel: null, currentModel: null, lastUsedModel: null,
      context: { tokens: null, contextWindow: 64000, percent: null }, tokens: null,
      usageStatus: 'unavailable', cost: null, costStatus: 'unavailable' });
    expect(text).toContain('unavailable / 64000 tokens (unavailable)');
    expect(text).toContain('Tokens: unavailable');
    expect(text).toContain('Cost: unavailable');
    expect(text).not.toContain('$0.0000');
    expect(text).toContain('Selected model: Default');
    expect(formatSessionInfo({ ...info, cost: 0 })).toContain('$0.0000');
  });
  it('labels partial usage and partial pricing', () => {
    const text = formatSessionInfo({ ...info, usageStatus: 'partial', costStatus: 'partial' });
    expect(text).toContain('Tokens: 1234 (partial)');
    expect(text).toContain('$0.1235 (estimate) (partial; some pricing unavailable)');
  });
});
