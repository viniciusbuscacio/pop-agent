import { describe, expect, it, vi } from 'vitest';
import type { ProviderAuthInteraction } from '../ports/agent-bridge.js';
import { OAuthFlowService } from './oauth-flow-service.js';

/**
 * The flow is exercised with a scripted login: a fake engine that emits the
 * events a real provider would, asks for a code, and succeeds or fails on
 * what it gets back. No network, no pi.
 */

const PROVIDER = 'openai-codex';

/** A login that shows a URL, asks for a code, and accepts only "good". */
function scriptedLogin(providerId: string, interaction: ProviderAuthInteraction): Promise<void> {
  interaction.notify({ type: 'auth_url', url: 'https://example.test/auth', instructions: 'Open it' });
  return interaction
    .prompt({ type: 'manual_code', message: 'Paste the code', placeholder: 'code' })
    .then((code) => {
      if (code !== 'good') throw new Error('invalid code');
      interaction.notify({ type: 'progress', message: 'Exchanging the code…' });
    });
}

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('OAuthFlowService', () => {
  it('refuses a provider that does not sign in with OAuth', () => {
    const service = new OAuthFlowService({ login: scriptedLogin });

    expect(() => service.start('openrouter')).toThrow(/not an OAuth provider/);
    expect(() => service.start('nope')).toThrow(/not an OAuth provider/);
  });

  it('carries the events and the pending question to the transcript', async () => {
    const service = new OAuthFlowService({ login: scriptedLogin });

    const { flowId } = service.start(PROVIDER);
    await flush();

    const state = service.state();
    expect(state?.flowId).toBe(flowId);
    expect(state?.providerId).toBe(PROVIDER);
    expect(state?.events).toEqual([
      { type: 'auth_url', url: 'https://example.test/auth', instructions: 'Open it' },
    ]);
    expect(state?.pending).toEqual({
      type: 'manual_code',
      message: 'Paste the code',
      placeholder: 'code',
    });
    expect(state?.done).toBe(false);
  });

  it('finishes ok when the submitted answer satisfies the flow', async () => {
    const service = new OAuthFlowService({ login: scriptedLogin });
    service.start(PROVIDER);
    await flush();

    expect(service.submit('good')).toBe(true);
    await flush();

    const state = service.state();
    expect(state?.done).toBe(true);
    expect(state?.ok).toBe(true);
    expect(state?.pending).toBeUndefined();
    expect(state?.events.at(-1)).toEqual({ type: 'progress', message: 'Exchanging the code…' });
  });

  it('finishes with the flow s own words when the answer is refused', async () => {
    const service = new OAuthFlowService({ login: scriptedLogin });
    service.start(PROVIDER);
    await flush();

    service.submit('bad');
    await flush();

    const state = service.state();
    expect(state?.done).toBe(true);
    expect(state?.ok).toBe(false);
    expect(state?.error).toBe('invalid code');
  });

  it('has nothing to submit to before a prompt or after the end', async () => {
    const service = new OAuthFlowService({ login: scriptedLogin });
    expect(service.submit('early')).toBe(false);

    service.start(PROVIDER);
    await flush();
    service.submit('good');
    await flush();

    expect(service.submit('late')).toBe(false);
  });

  it('cancel aborts the flow and says so', async () => {
    const service = new OAuthFlowService({ login: scriptedLogin });
    service.start(PROVIDER);
    await flush();

    service.cancel();
    await flush();

    const state = service.state();
    expect(state?.done).toBe(true);
    expect(state?.ok).toBe(false);
    expect(state?.error).toBe('The sign-in was cancelled.');
    expect(state?.pending).toBeUndefined();
  });

  it('starting a new flow cancels the previous one', async () => {
    let aborted = false;
    const service = new OAuthFlowService({
      login: (_provider, interaction) =>
        new Promise((_resolve, reject) => {
          interaction.signal?.addEventListener('abort', () => {
            aborted = true;
            reject(new Error('aborted'));
          });
        }),
    });

    const first = service.start(PROVIDER);
    const second = service.start('github-copilot');

    expect(aborted).toBe(true);
    expect(second.flowId).not.toBe(first.flowId);
    expect(service.state()?.providerId).toBe('github-copilot');
  });

  it('times out a flow nobody finishes', async () => {
    vi.useFakeTimers();
    try {
      const service = new OAuthFlowService({
        login: () => new Promise(() => undefined),
        timeoutMs: 50,
      });
      service.start(PROVIDER);

      vi.advanceTimersByTime(60);

      const state = service.state();
      expect(state?.done).toBe(true);
      expect(state?.ok).toBe(false);
      expect(state?.error).toMatch(/took too long/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never lets token material into the transcript', async () => {
    // A login that resolves with a credential the engine would store: the
    // service must expose only the events it was explicitly told about.
    const service = new OAuthFlowService({
      login: (_provider, interaction) => {
        interaction.notify({ type: 'progress', message: 'Signing in…' });
        return Promise.resolve();
      },
    });
    service.start(PROVIDER);
    await flush();

    const wire = JSON.stringify(service.state());
    expect(wire).not.toMatch(/token|refresh|access|credential/i);
    expect(service.state()?.ok).toBe(true);
  });
});
