import { describe, expect, it, vi } from 'vitest';
import { OpenAiCompatibleGateway } from './openai-compatible-gateway.js';

describe('OpenAiCompatibleGateway.complete', () => {
  it('passes through usage when the provider reports it', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'hello' } }],
          usage: { prompt_tokens: 12, completion_tokens: 3, total_cost: 0.001 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const gateway = new OpenAiCompatibleGateway('https://example.test/v1');
    const answer = await gateway.complete({
      apiKey: 'key',
      model: 'test/model',
      prompt: 'hi',
      maxTokens: 16,
    });

    expect(answer.text).toBe('hello');
    expect(answer.usage).toMatchObject({
      inputTokens: 12,
      outputTokens: 3,
      cost: 0.001,
      model: 'test/model',
    });

    vi.unstubAllGlobals();
  });

  it('returns text alone when the provider omits usage', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const gateway = new OpenAiCompatibleGateway('https://example.test/v1');
    const answer = await gateway.complete({
      apiKey: 'key',
      model: 'test/model',
      prompt: 'hi',
      maxTokens: 16,
    });

    expect(answer.text).toBe('ok');
    expect(answer.usage).toBeUndefined();

    vi.unstubAllGlobals();
  });
});
