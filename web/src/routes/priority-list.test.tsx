// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderStatusDTO } from '@popy/shared';
import { PriorityList } from './priority-list';

/**
 * The list the user edits is the whole contract (popy.spec §15, fase 2):
 * what it shows at #1 is what a new chat uses, and what it shows switched
 * off never answers. This suite guards the two claims the UI makes.
 */

const setOrder = vi.fn();
const setEnabled = vi.fn();

vi.mock('../services/providers', () => ({
  providersService: {
    setOrder: (ids: string[]) => setOrder(ids) as Promise<unknown>,
    setEnabled: (id: string, enabled: boolean) => setEnabled(id, enabled) as Promise<unknown>,
  },
}));

function provider(overrides: Partial<ProviderStatusDTO> & { id: string }): ProviderStatusDTO {
  return {
    name: overrides.id,
    authType: 'api-key',
    configured: true,
    source: 'settings',
    defaultModel: 'm',
    allowCustomModel: true,
    order: 1,
    enabled: true,
    ...overrides,
  };
}

const PROVIDERS = [
  provider({ id: 'anthropic', order: 2 }),
  provider({ id: 'openrouter', order: 1 }),
  provider({ id: 'openai', order: 3, configured: false }),
];

afterEach(cleanup);

beforeEach(() => {
  setOrder.mockReset();
  setEnabled.mockReset();
  setOrder.mockResolvedValue({ providers: [] });
  setEnabled.mockResolvedValue({ providers: [] });
});

describe('PriorityList', () => {
  it('numbers the providers by their stored order, not the order they arrived in', () => {
    render(<PriorityList providers={PROVIDERS} onChanged={vi.fn()} />);

    const rows = screen.getAllByRole('listitem').map((row) => row.textContent ?? '');
    expect(rows[0]).toContain('openrouter');
    expect(rows[1]).toContain('anthropic');
    expect(rows[2]).toContain('openai');
  });

  it('marks only the head as the default', () => {
    render(<PriorityList providers={PROVIDERS} onChanged={vi.fn()} />);

    expect(screen.getAllByTestId('provider-priority-default')).toHaveLength(1);
  });

  it('sends the whole reordered list when a provider moves up', async () => {
    render(<PriorityList providers={PROVIDERS} onChanged={vi.fn()} />);

    fireEvent.click(screen.getByTestId('provider-priority-up-anthropic'));

    await waitFor(() => {
      expect(setOrder).toHaveBeenCalledWith(['anthropic', 'openrouter', 'openai']);
    });
  });

  it('cannot move the head up or the tail down', () => {
    render(<PriorityList providers={PROVIDERS} onChanged={vi.fn()} />);

    expect(screen.getByTestId('provider-priority-up-openrouter')).toHaveProperty('disabled', true);
    expect(screen.getByTestId('provider-priority-down-openai')).toHaveProperty('disabled', true);
  });

  it('flips the switch to the opposite of what the provider reports', async () => {
    render(
      <PriorityList
        providers={[provider({ id: 'openrouter', order: 1, enabled: false })]}
        onChanged={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('provider-priority-toggle-openrouter'));

    await waitFor(() => {
      expect(setEnabled).toHaveBeenCalledWith('openrouter', true);
    });
  });

  it('says why a provider will not answer instead of skipping it silently', () => {
    render(<PriorityList providers={PROVIDERS} onChanged={vi.fn()} />);

    const openai = screen.getByTestId('provider-priority-row-openai');
    expect(openai.textContent).toContain('Not configured');
  });
});
