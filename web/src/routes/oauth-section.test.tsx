// @vitest-environment happy-dom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderStatusDTO } from '@pop-agent/shared';
import { OAuthSection } from './oauth-section';

/**
 * The sign-in card outlives the page (pop-agent.spec §15, fase 1.5). Signing in
 * means leaving for the provider and coming back, and on the way back the
 * page is frequently a fresh mount: a new tab, a reload, or the PWA resumed
 * from the background. If the card only knew about flows it had started
 * itself, it would offer "Sign in" again while the server sat waiting for the
 * code -- the dead end this suite exists to prevent.
 *
 * The second thing it guards is the choice of method: on a self-hosted
 * install the browser redirect cannot complete on its own, so the card must
 * not repeat pi's advice that it is the default.
 */

const oauthState = vi.fn();
const oauthStart = vi.fn();
const oauthCancel = vi.fn();
const oauthInput = vi.fn();
const list = vi.fn();

vi.mock('../services/providers', () => ({
  providersService: {
    oauthState: (id: string) => oauthState(id) as Promise<unknown>,
    oauthStart: (id: string) => oauthStart(id) as Promise<unknown>,
    oauthInput: (id: string, value: string) => oauthInput(id, value) as Promise<unknown>,
    oauthCancel: (id: string) => oauthCancel(id) as Promise<unknown>,
    oauthLogout: vi.fn(),
    list: () => list() as Promise<unknown>,
  },
}));

const PROVIDER: ProviderStatusDTO = {
  id: 'openai-codex',
  name: 'OpenAI — ChatGPT subscription',
  configured: false,
  source: null,
  authType: 'oauth',
  defaultModel: 'gpt-5.5',
  serviceModel: 'gpt-5.5',
  allowCustomModel: false,
  order: 1,
  enabled: true,
};

/** What the server reports while it waits for the pasted redirect URL. */
const WAITING_FOR_PASTE = {
  flowId: 'flow-1',
  providerId: 'openai-codex',
  events: [{ type: 'auth_url' as const, url: 'https://auth.openai.com/oauth/authorize?x=1' }],
  pending: {
    type: 'manual_code' as const,
    message: 'Complete login in your browser, or paste the code here:',
    placeholder: 'http://localhost:1455/auth/callback',
  },
  done: false,
};

/** What pi asks first for a subscription that offers both methods. */
const CHOOSING_METHOD = {
  flowId: 'flow-2',
  providerId: 'openai-codex',
  events: [],
  pending: {
    type: 'select' as const,
    message: 'Select OpenAI Codex login method:',
    options: [
      { id: 'browser', label: 'Browser login (default)' },
      { id: 'device_code', label: 'Device code login (headless)' },
    ],
  },
  done: false,
};

/**
 * What GitHub Copilot asks: the Enterprise domain, where leaving it blank
 * MEANS github.com. A free-text question whose correct answer is empty.
 */
const ASKING_FOR_DOMAIN = {
  flowId: 'flow-3',
  providerId: 'openai-codex',
  events: [],
  pending: {
    type: 'text' as const,
    message: 'GitHub Enterprise URL/domain (blank for github.com)',
    placeholder: 'company.ghe.com',
  },
  done: false,
};

afterEach(cleanup);

beforeEach(() => {
  oauthState.mockReset();
  oauthStart.mockReset();
  oauthCancel.mockReset();
  oauthCancel.mockResolvedValue(undefined);
  oauthInput.mockReset();
  oauthInput.mockResolvedValue(undefined);
  list.mockReset();
  list.mockResolvedValue({ providers: [PROVIDER] });
});

describe('OAuthSection', () => {
  it('lets a free-text question be answered with nothing', async () => {
    // GitHub Copilot's domain prompt says "blank for github.com", and a
    // length guard made that one correct answer the one you could not give.
    oauthState.mockResolvedValue(ASKING_FOR_DOMAIN);

    render(<OAuthSection provider={PROVIDER} onChanged={vi.fn()} />);

    const submit = await screen.findByTestId('provider-oauth-submit-openai-codex');
    expect((submit as HTMLButtonElement).disabled).toBe(false);
  });

  it('still guards an empty code, where blank means nothing', async () => {
    // Not a rule about text length -- a rule about which questions have a
    // meaningful empty answer. A pasted code does not.
    oauthState.mockResolvedValue(WAITING_FOR_PASTE);

    render(<OAuthSection provider={PROVIDER} onChanged={vi.fn()} />);

    const submit = await screen.findByTestId('provider-oauth-submit-openai-codex');
    expect((submit as HTMLButtonElement).disabled).toBe(true);
  });

  it('sends on Enter, so the keyboard finishes what it started', async () => {
    // The input sits outside a <form>: without this the only way through a
    // screen made of one question and one field was the mouse.
    const user = userEvent.setup();
    oauthState.mockResolvedValue(ASKING_FOR_DOMAIN);

    render(<OAuthSection provider={PROVIDER} onChanged={vi.fn()} />);

    const box = await screen.findByTestId('provider-oauth-answer-openai-codex');
    await user.click(box);
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(oauthInput).toHaveBeenCalledWith('openai-codex', '');
    });
  });

  it('adopts a sign-in already running on the server', async () => {
    oauthState.mockResolvedValue(WAITING_FOR_PASTE);

    render(<OAuthSection provider={PROVIDER} onChanged={vi.fn()} />);

    // The paste box appears without anyone pressing "Sign in" on this mount.
    await waitFor(() => {
      expect(screen.getByTestId('provider-oauth-answer-openai-codex')).toBeTruthy();
    });
    expect(oauthStart).not.toHaveBeenCalled();
  });

  it('warns that the page will not load before asking for its address', async () => {
    oauthState.mockResolvedValue(WAITING_FOR_PASTE);

    render(<OAuthSection provider={PROVIDER} onChanged={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/does not load/i)).toBeTruthy();
    });
    // The sign-in link belongs to the steps, and appears once -- not again as
    // a loose transcript row saying the same thing.
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('offers the code method first, in Pop Agent words, not pi defaults', async () => {
    oauthState.mockResolvedValue(CHOOSING_METHOD);

    render(<OAuthSection provider={PROVIDER} onChanged={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('provider-oauth-method-openai-codex')).toBeTruthy();
    });
    const buttons = screen.getAllByRole('button').map((button) => button.textContent ?? '');
    const code = buttons.findIndex((text) => text.includes('With a code'));
    const browser = buttons.findIndex((text) => text.includes('With a browser redirect'));
    expect(code).toBeGreaterThanOrEqual(0);
    expect(code).toBeLessThan(browser);
    // pi calls the redirect "(default)"; on a self-hosted install it is not.
    expect(screen.queryByText(/default/i)).toBeNull();
  });

  it('stays quiet when no sign-in is running', async () => {
    // The server answers 404 for "nothing running"; the service rejects.
    oauthState.mockRejectedValue(new Error('not_found'));

    render(<OAuthSection provider={PROVIDER} onChanged={vi.fn()} />);

    await waitFor(() => {
      expect(oauthState).toHaveBeenCalledWith('openai-codex');
    });
    expect(screen.queryByTestId('provider-oauth-answer-openai-codex')).toBeNull();
  });

  it('does not show a leftover sign-in next to a connected status', async () => {
    // Two contradictory claims in one card ("Connected" plus "paste your
    // code") is what made this unreadable in the first place.
    oauthState.mockResolvedValue(WAITING_FOR_PASTE);

    render(<OAuthSection provider={{ ...PROVIDER, configured: true, source: 'oauth' }} onChanged={vi.fn()} />);

    await waitFor(() => {
      expect(oauthCancel).toHaveBeenCalledWith('openai-codex');
    });
    expect(screen.queryByTestId('provider-oauth-answer-openai-codex')).toBeNull();
  });
  /**
   * The sign-in landing and the card saying so are two different events, and
   * only the first one was ever tested. On 08/08 the ChatGPT subscription
   * signed in -- the credential was on disk, timestamped -- and the card sat
   * on "Waiting for the provider…" until it was reloaded. These three cover
   * the ways the news gets here.
   */
  it('says so when the flow finishes, and refreshes the card', async () => {
    vi.useFakeTimers();
    try {
      const onChanged = vi.fn();
      oauthState.mockResolvedValue(WAITING_FOR_PASTE);
      render(<OAuthSection provider={PROVIDER} onChanged={onChanged} />);
      await act(async () => vi.advanceTimersByTimeAsync(0));

      list.mockResolvedValue({
        providers: [{ ...PROVIDER, configured: true, source: 'oauth' }],
      });
      oauthState.mockResolvedValue({
        flowId: 'flow-1',
        providerId: 'openai-codex',
        events: WAITING_FOR_PASTE.events,
        done: true,
        ok: true,
      });
      await act(async () => vi.advanceTimersByTimeAsync(2100));

      expect(screen.getByRole('status').textContent).toContain('Signed in');
      expect(list).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports failure when the flow finishes without a saved credential', async () => {
    vi.useFakeTimers();
    try {
      oauthState.mockResolvedValue(WAITING_FOR_PASTE);
      render(<OAuthSection provider={PROVIDER} onChanged={vi.fn()} />);
      await act(async () => vi.advanceTimersByTimeAsync(0));

      list.mockResolvedValue({ providers: [PROVIDER] });
      oauthState.mockResolvedValue({
        flowId: 'flow-1',
        providerId: 'openai-codex',
        events: WAITING_FOR_PASTE.events,
        done: true,
        ok: true,
      });
      await act(async () => vi.advanceTimersByTimeAsync(2100));

      expect(screen.getByRole('status').textContent).toContain('no credential was saved');
    } finally {
      vi.useRealTimers();
    }
  });

  it('still reports success when the poll dies before the flow finishes', async () => {
    // The service restarting takes the in-memory flow with it, and a
    // backgrounded PWA can miss the one tick that carried the news. Neither
    // may leave the card waiting on a sign-in that already worked.
    vi.useFakeTimers();
    try {
      oauthState.mockResolvedValue(WAITING_FOR_PASTE);
      render(<OAuthSection provider={PROVIDER} onChanged={vi.fn()} />);
      await act(async () => vi.advanceTimersByTimeAsync(0));

      oauthState.mockRejectedValue(new Error('not_found'));
      list.mockResolvedValue({ providers: [{ ...PROVIDER, configured: true, source: 'oauth' }] });
      await act(async () => vi.advanceTimersByTimeAsync(4200));

      expect(screen.getByRole('status').textContent).toContain('Signed in');
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops waiting when the flow is gone and nothing was signed in', async () => {
    vi.useFakeTimers();
    try {
      oauthState.mockResolvedValue(WAITING_FOR_PASTE);
      render(<OAuthSection provider={PROVIDER} onChanged={vi.fn()} />);
      await act(async () => vi.advanceTimersByTimeAsync(0));

      oauthState.mockRejectedValue(new Error('not_found'));
      await act(async () => vi.advanceTimersByTimeAsync(4200));

      expect(screen.getByTestId('provider-oauth-error-openai-codex').textContent).toContain(
        'no longer running',
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
