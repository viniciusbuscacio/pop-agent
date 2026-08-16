// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderStatusDTO } from '@pop-agent/shared';
import { ProvidersSection } from './providers-section';

const list = vi.fn();
const subscriptionUsage = vi.fn();

vi.mock('../services/providers', () => ({
  normalizeBaseUrl: (value: string) => value,
  providersService: {
    list: () => list() as Promise<unknown>,
    credits: () => Promise.reject(new Error('no balance')),
    subscriptionUsage: (providerId: string) => subscriptionUsage(providerId) as Promise<unknown>,
    setEnabled: vi.fn(),
    setOrder: vi.fn(),
    setKey: vi.fn(),
    clearKey: vi.fn(),
    test: vi.fn(),
    setDefaultModel: vi.fn(),
    setServiceModel: vi.fn(),
    createCustom: vi.fn(),
    updateCustom: vi.fn(),
    deleteCustom: vi.fn(),
    oauthStart: vi.fn(),
    oauthState: vi.fn(),
    oauthInput: vi.fn(),
    oauthCancel: vi.fn(),
    oauthLogout: vi.fn(),
  },
}));

const CODEX: ProviderStatusDTO = {
  id: 'openai-codex',
  name: 'OpenAI — ChatGPT subscription',
  authType: 'oauth',
  configured: true,
  source: 'oauth',
  defaultModel: 'gpt-5.6-sol',
  serviceModel: 'gpt-5.6-sol',
  allowCustomModel: false,
  order: 1,
  enabled: true,
};

afterEach(cleanup);

beforeEach(() => {
  list.mockReset();
  list.mockResolvedValue({ providers: [CODEX] });
  subscriptionUsage.mockReset();
  subscriptionUsage.mockResolvedValue({
    plan: 'plus',
    allowed: true,
    limitReached: false,
    primary: { usedPercent: 3, windowSeconds: 604_800, resetAt: 1_786_894_871 },
  });
});

describe('OpenAI subscription card', () => {
  it('shows the provider allowance inside Settings > Model', async () => {
    render(<ProvidersSection />);

    expect(await screen.findByText('Weekly usage')).toBeTruthy();
    expect(screen.getByText('3%')).toBeTruthy();
    expect(screen.getByText('Plus plan')).toBeTruthy();
    expect(screen.getByText(/^Resets /)).toBeTruthy();
    expect(screen.getByTestId('provider-card-name').textContent).toBe('OpenAI — ChatGPT subscription');
    expect(screen.getByTestId('provider-card-name').className).not.toContain('truncate');
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('provider-edit').parentElement?.className).toContain('grid-cols-2');
    const progress = screen.getByRole('progressbar', { name: 'Weekly usage' });
    expect(progress.getAttribute('aria-valuenow')).toBe('3');
    await waitFor(() => expect(subscriptionUsage).toHaveBeenCalledWith('openai-codex'));
  });
});
