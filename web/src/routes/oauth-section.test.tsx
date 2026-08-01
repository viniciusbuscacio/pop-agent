// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderStatusDTO } from '@popy/shared';
import { OAuthSection } from './oauth-section';

/**
 * The sign-in card outlives the page (popy.spec §15, fase 1.5). Signing in
 * means leaving for the provider and coming back, and on the way back the
 * page is frequently a fresh mount: a new tab, a reload, or the PWA resumed
 * from the background. If the card only knew about flows it had started
 * itself, it would offer "Sign in" again while the server sat waiting for the
 * code -- the dead end this suite exists to prevent.
 */

const oauthState = vi.fn();
const oauthStart = vi.fn();
const oauthCancel = vi.fn();

vi.mock('../services/providers', () => ({
  providersService: {
    oauthState: (id: string) => oauthState(id) as Promise<unknown>,
    oauthStart: (id: string) => oauthStart(id) as Promise<unknown>,
    oauthInput: vi.fn(),
    oauthCancel: (id: string) => oauthCancel(id) as Promise<unknown>,
    oauthLogout: vi.fn(),
    list: vi.fn(),
  },
}));

const PROVIDER: ProviderStatusDTO = {
  id: 'openai-codex',
  name: 'OpenAI — ChatGPT subscription',
  configured: false,
  source: null,
  authType: 'oauth',
  defaultModel: 'gpt-5.5',
  allowCustomModel: false,
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

afterEach(cleanup);

beforeEach(() => {
  oauthState.mockReset();
  oauthStart.mockReset();
  oauthCancel.mockReset();
  oauthCancel.mockResolvedValue(undefined);
});

describe('OAuthSection', () => {
  it('adopts a sign-in already running on the server', async () => {
    oauthState.mockResolvedValue(WAITING_FOR_PASTE);

    render(<OAuthSection provider={PROVIDER} onChanged={vi.fn()} />);

    // The paste box appears without anyone pressing "Sign in" on this mount.
    await waitFor(() => {
      expect(screen.getByTestId('provider-oauth-answer-openai-codex')).toBeTruthy();
    });
    expect(oauthStart).not.toHaveBeenCalled();
  });

  it('explains the blank localhost page while a pasted code is pending', async () => {
    oauthState.mockResolvedValue(WAITING_FOR_PASTE);

    render(<OAuthSection provider={PROVIDER} onChanged={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/blank localhost page/i)).toBeTruthy();
    });
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
});
