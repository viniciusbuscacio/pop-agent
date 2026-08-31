// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderStatusDTO } from '@pop-agent/shared';
import { ProvidersSection } from './providers-section';

const list = vi.fn();
const subscriptionUsage = vi.fn();
const saveConfiguration = vi.fn();
const createConfiguredCustom = vi.fn();

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
    saveConfiguration: (id: string, configuration: unknown) =>
      saveConfiguration(id, configuration) as Promise<unknown>,
    createConfiguredCustom: (configuration: unknown) =>
      createConfiguredCustom(configuration) as Promise<unknown>,
    deleteCustom: vi.fn(),
    oauthStart: vi.fn(),
    oauthState: vi.fn(() => Promise.reject(new Error('no active flow'))),
    oauthInput: vi.fn(),
    oauthCancel: vi.fn(),
    oauthLogout: vi.fn(),
  },
}));

vi.mock('../services/chats', () => ({
  chatsService: { models: () => Promise.resolve({ models: [], source: 'static' }) },
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
  saveConfiguration.mockReset().mockResolvedValue({ providers: [CODEX] });
  createConfiguredCustom.mockReset();
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

describe('provider configuration flow', () => {
  it('saves one provider card through one request', async () => {
    const user = userEvent.setup();
    render(<ProvidersSection />);
    await user.click(await screen.findByTestId('provider-edit'));

    fireEvent.change(screen.getByTestId('provider-model'), {
      target: { value: 'gpt-5.6-terra' },
    });
    await user.click(screen.getByTestId('provider-save'));

    await waitFor(() =>
      expect(saveConfiguration).toHaveBeenCalledWith(
        'openai-codex',
        expect.objectContaining({ defaultModel: 'gpt-5.6-terra', priority: 1 }),
      ),
    );
  });

  it('does not create an invisible custom provider when the draft is cancelled', async () => {
    list.mockResolvedValue({ providers: [] });
    const user = userEvent.setup();
    render(<ProvidersSection />);

    await user.click(await screen.findByTestId('provider-add'));
    await user.click(screen.getByText('Custom (OpenAI-compatible) — API key'));
    expect(screen.getByTestId('provider-name')).toBeTruthy();
    await user.click(screen.getByTestId('provider-back'));

    expect(createConfiguredCustom).not.toHaveBeenCalled();
    expect(await screen.findByText('No providers yet. Add one and Pop Agent can start answering.')).toBeTruthy();
  });
});
