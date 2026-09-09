import { afterEach, describe, expect, it, vi } from 'vitest';
import { stream } from '../node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/api/openai-codex-responses.js';
import type { AgentEvent } from '../server/src/application/ports/agent-bridge.js';
import { shouldFailOver } from '../server/src/application/chat/failover.js';
import { RunTranslator } from '../server/src/infrastructure/agent/pi-run-translation.js';

afterEach(() => vi.unstubAllGlobals());

describe('installed pi Codex refusal handling', () => {
  it.each([
    [429, 'usage_limit_reached', true],
    [429, 'rate_limit_exceeded', true],
    [401, 'invalid_token', true],
    [503, 'unavailable', true],
    [400, 'invalid_request', false],
  ] as const)('preserves HTTP %s (%s) through SDK translation', async (status, code, failover) => {
    const fetch = vi.fn(async () => Response.json({ error: { code, message: 'Provider refusal', plan_type: 'plus' } }, { status }));
    vi.stubGlobal('fetch', fetch);
    const token = `test.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'test-account' } })).toString('base64url')}.test`;
    const result = await stream({
      id: 'gpt-5.6-sol', name: 'Test Codex', provider: 'openai-codex',
      api: 'openai-codex-responses', baseUrl: 'https://codex.invalid/backend-api',
      reasoning: true, input: ['text'], contextWindow: 128000, maxTokens: 4096,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    }, { messages: [{ role: 'user', content: 'hello', timestamp: 0 }] }, {
      apiKey: token, transport: 'sse', maxRetries: 0,
    }).result();

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.stopReason).toBe('error');
    if (status === 429) expect(result.errorMessage).toContain('You have hit your ChatGPT usage limit');
    const events: AgentEvent[] = [];
    const translator = new RunTranslator(event => events.push(event));
    translator.handle({ type: 'message_end', message: result });
    translator.finish(false);
    expect(events).toEqual([{ kind: 'error', code: 'provider_error', status }]);
    expect(shouldFailOver(translator.failure!)).toBe(failover);
  });
});
