import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SdkPiEngine } from './pi-engine.js';

let root: string | undefined;

afterEach(() => {
  vi.unstubAllGlobals();
  if (root !== undefined) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

describe('OpenAI subscription usage', () => {
  it('resolves through pi auth and returns only allowance fields', async () => {
    root = mkdtempSync(join(tmpdir(), 'pop-codex-usage-'));
    const authPath = join(root, 'auth.json');
    writeFileSync(
      authPath,
      JSON.stringify({
        'openai-codex': {
          type: 'oauth',
          access: 'fake-access',
          refresh: 'fake-refresh',
          expires: Date.now() + 60 * 60 * 1000,
          accountId: 'fake-account',
        },
      }),
    );
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          user_id: 'must-not-cross',
          email: 'must-not-cross@example.invalid',
          plan_type: 'plus',
          rate_limit: {
            allowed: true,
            limit_reached: false,
            primary_window: {
              used_percent: 3,
              limit_window_seconds: 604_800,
              reset_at: 1_786_894_871,
            },
            secondary_window: null,
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const engine = new SdkPiEngine({
      workspace: join(root, 'workspace'),
      sessionsDir: join(root, 'sessions'),
      agentDir: join(root, 'agent'),
      authPath,
      modelsStorePath: join(root, 'models-store.json'),
      apiKey: () => undefined,
    });

    await expect(engine.providerSubscriptionUsage('openai-codex')).resolves.toEqual({
      plan: 'plus',
      allowed: true,
      limitReached: false,
      primary: { usedPercent: 3, windowSeconds: 604_800, resetAt: 1_786_894_871 },
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://chatgpt.com/backend-api/wham/usage');
    expect(new Headers(init.headers).get('ChatGPT-Account-Id')).toBe('fake-account');
  });
});
