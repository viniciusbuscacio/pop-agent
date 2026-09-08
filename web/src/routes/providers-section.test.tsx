// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderStatusDTO } from '@pop-agent/shared';
import { ProvidersSection } from './providers-section';
import { clearSubscriptionUsageCache } from '../services/subscription-usage-cache';

const checkHealth = vi.fn();
vi.mock('../services/health', () => ({ healthMonitor: { refreshAfterProviderChange: () => checkHealth() } }));

const oauthState = vi.fn();
const list = vi.fn();
const subscriptionUsage = vi.fn();
const saveConfiguration = vi.fn();
const createConfiguredCustom = vi.fn();
const models = vi.fn();
const refreshModels = vi.fn();

vi.mock('../services/providers', () => ({
  normalizeBaseUrl: (value: string) => value,
  providersService: {
    list: () => list() as Promise<unknown>,
    credits: () => Promise.reject(new Error('no balance')),
    subscriptionUsage: (providerId: string) => subscriptionUsage(providerId) as Promise<unknown>,
    refreshModels: (providerId: string) => refreshModels(providerId) as Promise<unknown>,
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
    oauthState: () => oauthState() as Promise<unknown>,
    oauthInput: vi.fn(),
    oauthCancel: vi.fn(),
    oauthLogout: vi.fn(),
  },
}));

vi.mock('../services/chats', () => ({
  chatsService: { models: (id: string) => models(id) as Promise<unknown> },
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
  clearSubscriptionUsageCache();
  checkHealth.mockClear();
  models.mockReset().mockResolvedValue({ models: [], source: 'engine' });
  refreshModels.mockReset().mockResolvedValue({ models: [], source: 'engine' });
  oauthState.mockReset().mockRejectedValue(new Error('no active flow'));
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
  it('retains cached usage on remount, refresh failure and replacement', async () => {
    const first = render(<ProvidersSection />);
    await screen.findByText('3%');
    first.unmount();
    subscriptionUsage.mockRejectedValueOnce(new Error('temporarily unavailable'));
    const second = render(<ProvidersSection />);
    await screen.findByTestId('provider-card-openai-codex');
    expect(screen.getByText('3%')).toBeTruthy();
    await waitFor(() => expect(subscriptionUsage).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Plus plan')).toBeTruthy();
    second.unmount();
    let finish!: (value: unknown) => void;
    subscriptionUsage.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<ProvidersSection />);
    await screen.findByTestId('provider-card-openai-codex');
    expect(screen.getByText('3%')).toBeTruthy();
    finish({ plan: 'plus', allowed: true, limitReached: false,
      primary: { usedPercent: 31, windowSeconds: 604800, resetAt: 1786894871 } });
    await screen.findByText('31%');
    expect(screen.queryByText('3%')).toBeNull();
  });

  it('shows the provider allowance inside Settings > Model', async () => {
    render(<ProvidersSection />);

    expect(await screen.findByText('Weekly usage')).toBeTruthy();
    expect(screen.getByText('3%')).toBeTruthy();
    expect(screen.getByText('Plus plan')).toBeTruthy();
    expect(screen.getByText(/^Resets /)).toBeTruthy();
    expect(screen.getByTestId('provider-card-name').textContent).toBe('OpenAI — ChatGPT subscription');
    expect(screen.getByTestId('provider-card-name').className).not.toContain('truncate');
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
    const edit = screen.getByTestId('provider-edit');
    expect(edit.parentElement?.className).toContain('grid-cols-2');
    expect(edit.parentElement?.className).toContain('sm:justify-end');
    expect(edit.className).toContain('sm:w-28');
    expect(screen.getByTestId('provider-delete').className).toContain('sm:w-28');
    const progress = screen.getByRole('progressbar', { name: 'Weekly usage' });
    expect(progress.getAttribute('aria-valuenow')).toBe('3');
    await waitFor(() => expect(subscriptionUsage).toHaveBeenCalledWith('openai-codex'));
  });
});

describe('provider configuration flow', () => {
  it('enables Save only after successful login is confirmed by provider status', async () => {
    list.mockResolvedValueOnce({ providers: [{ ...CODEX, configured: false, source: null }] }).mockResolvedValue({ providers: [CODEX] });
    oauthState.mockRejectedValueOnce(new Error('no active flow'))
      .mockResolvedValueOnce({ flowId: 'test', events: [], done: false })
      .mockResolvedValue({ flowId: 'test', events: [], done: true, ok: true });
    const done = vi.fn(); const user = userEvent.setup(); render(<ProvidersSection onSetupDone={done} />);
    await user.click((await screen.findAllByTestId('provider-choice'))[2]!);
    expect((screen.getByTestId('provider-save') as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByTestId('provider-oauth-signin-openai-codex'));
    expect((screen.getByTestId('provider-save') as HTMLButtonElement).disabled).toBe(true);
    await waitFor(() => expect((screen.getByTestId('provider-save') as HTMLButtonElement).disabled).toBe(false), { timeout: 3500 });
    expect(checkHealth).toHaveBeenCalledOnce();
    await user.click(screen.getByTestId('provider-save'));
    await waitFor(() => expect(done).toHaveBeenCalledOnce());
    expect(checkHealth).toHaveBeenCalledTimes(2);
  });

  it.each(['openai-codex', 'github-copilot'])('keeps Save disabled for %s until a credential exists', async (id) => {
    list.mockResolvedValue({ providers: [{ ...CODEX, id, name: id, configured: false, source: null }] });
    const done = vi.fn(); const user = userEvent.setup();
    render(<ProvidersSection onSetupDone={done} />);
    const choices = await screen.findAllByTestId('provider-choice');
    await user.click(choices[id === 'openai-codex' ? 2 : 4]!);
    expect((screen.getByTestId('provider-save') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(false);
    await user.click(screen.getByTestId('provider-save'));
    expect(saveConfiguration).not.toHaveBeenCalled(); expect(done).not.toHaveBeenCalled();
  });

  it('reuses the OAuth picker during setup and returns there on cancel', async () => {
    list.mockResolvedValue({ providers: [{ ...CODEX, configured: false }] });
    const done = vi.fn();
    const user = userEvent.setup();
    render(<ProvidersSection onSetupDone={done} />);
    expect((await screen.findAllByTestId('provider-choice')).length).toBe(6);
    await user.click(screen.getByText('OpenAI — ChatGPT subscription'));
    expect(screen.queryByTestId('provider-key')).toBeNull();
    await user.click(screen.getByTestId('provider-back'));
    expect(screen.getAllByTestId('provider-choice').length).toBe(6);
    expect(done).not.toHaveBeenCalled();
    await user.click(screen.getByTestId('setup-skip-provider'));
    expect(done).toHaveBeenCalledOnce();
  });

  it('finishes setup only after the shared provider save succeeds', async () => {
    const provider = { ...CODEX, id: 'openai', name: 'OpenAI', authType: 'api-key', configured: false };
    list.mockResolvedValue({ providers: [provider] });
    saveConfiguration.mockRejectedValueOnce(new Error('offline'));
    const done = vi.fn();
    const user = userEvent.setup();
    render(<ProvidersSection onSetupDone={done} />);
    await user.click(await screen.findByText('OpenAI — API key'));
    await user.type(screen.getByTestId('provider-key'), 'synthetic-key');
    await user.click(screen.getByTestId('provider-save'));
    await waitFor(() => expect(saveConfiguration).toHaveBeenCalledOnce());
    expect(done).not.toHaveBeenCalled();
    await user.click(screen.getByTestId('provider-save'));
    await waitFor(() => expect(done).toHaveBeenCalledOnce());
    expect(saveConfiguration).toHaveBeenLastCalledWith('openai', expect.objectContaining({ apiKey: 'synthetic-key' }));
  });

  it('lets setup skip a failed catalogue without displaying an unusable picker', async () => {
    list.mockRejectedValue(new Error('offline'));
    const done = vi.fn();
    const user = userEvent.setup();
    render(<ProvidersSection onSetupDone={done} />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByTestId('provider-choice')).toBeNull();
    await user.click(screen.getByTestId('setup-skip-provider'));
    expect(done).toHaveBeenCalledOnce();
  });

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


describe('subscription model refresh', () => {
  it.each(['openai-codex', 'github-copilot'])('reloads only %s and preserves unsaved fields', async id => {
    list.mockResolvedValue({ providers: [{ ...CODEX, id }] });
    const user = userEvent.setup();
    render(<ProvidersSection />);
    await user.click(await screen.findByTestId('provider-edit'));
    const input = screen.getByTestId('provider-model') as HTMLInputElement;
    await user.clear(input);
    await user.type(input, 'my-unsaved-model');
    refreshModels.mockClear();
    await user.click(screen.getByTestId('provider-refresh-models'));
    expect(await screen.findByText('Model list refreshed.')).toBeTruthy();
    expect(refreshModels).toHaveBeenCalledExactlyOnceWith(id);
    expect(input.value).toBe('my-unsaved-model');
    expect(saveConfiguration).not.toHaveBeenCalled();
  });

  it('disables repeat clicks while loading and keeps the selected model after failure', async () => {
    const user = userEvent.setup();
    render(<ProvidersSection />);
    await user.click(await screen.findByTestId('provider-edit'));
    let reject!: (error: Error) => void;
    refreshModels.mockImplementationOnce(() => new Promise((_resolve, no) => { reject = no; }));
    const button = screen.getByTestId('provider-refresh-models') as HTMLButtonElement;
    await user.click(button);
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe('Refreshing models…');
    reject(new Error('unreachable'));
    await screen.findByText('Could not refresh models. Your previous list and selections were kept.');
    expect((screen.getByTestId('provider-model') as HTMLInputElement).value).toBe(CODEX.defaultModel);
    expect(button.disabled).toBe(false);
  });
});
