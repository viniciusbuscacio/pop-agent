import { describe, expect, it, vi } from 'vitest';
import { serverLoginInteraction } from './codex-login-interaction.js';

const methods = { type: 'select' as const, message: 'Choose a method', options: [
  { id: 'browser', label: 'Browser (default)' }, { id: 'device_code', label: 'Device code' },
] };
describe('server-hosted Codex login', () => {
  it('selects device code without exposing the localhost redirect to the client', async () => {
    const interaction = { prompt: vi.fn(), notify: vi.fn(), signal: new AbortController().signal };
    const adapted = serverLoginInteraction('openai-codex', interaction);
    expect(await adapted.prompt(methods)).toBe('device_code');
    expect(interaction.prompt).not.toHaveBeenCalled();
    expect(adapted.signal).toBe(interaction.signal);
    const event = { type: 'device_code' as const, userCode: 'test-code', verificationUri: 'https://example.invalid/activate' };
    adapted.notify(event); expect(interaction.notify).toHaveBeenCalledWith(event);
  });
  it('fails explicitly if the runtime only supports a browser callback', async () => {
    const interaction = { prompt: vi.fn(), notify: vi.fn() };
    await expect(serverLoginInteraction('openai-codex', interaction).prompt({ ...methods, options: methods.options.slice(0, 1) })).rejects.toThrow('Code-based sign-in is unavailable');
    expect(interaction.prompt).not.toHaveBeenCalled();
  });
  it('preserves other providers and unrelated prompts', async () => {
    const interaction = { prompt: vi.fn(async () => 'answer'), notify: vi.fn() };
    expect(serverLoginInteraction('github-copilot', interaction)).toBe(interaction);
    const prompt = { type: 'text' as const, message: 'Question' };
    expect(await serverLoginInteraction('openai-codex', interaction).prompt(prompt)).toBe('answer');
    expect(interaction.prompt).toHaveBeenCalledWith(prompt);
  });
});
