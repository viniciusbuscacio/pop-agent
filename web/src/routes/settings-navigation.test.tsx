// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsPage } from './settings-page';

vi.mock('../services/pwa-update', () => ({
  applyUpdate: vi.fn(),
  checkForUpdateNow: vi.fn(),
}));

vi.mock('../services/push', () => ({
  pushService: {
    supported: vi.fn(() => true),
    isSubscribed: vi.fn(() => Promise.resolve(false)),
    enable: vi.fn(() => Promise.resolve(true)),
    disable: vi.fn(() => Promise.resolve()),
  },
}));

afterEach(cleanup);

describe('Settings navigation', () => {
  it('starts with a searchable, grouped index instead of tabs', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/settings']}><SettingsPage /></MemoryRouter>);

    expect(screen.getByText('Agent')).toBeTruthy();
    expect(screen.getByText('App')).toBeTruthy();
    expect(screen.getByText('Data')).toBeTruthy();
    expect(screen.getByText('System')).toBeTruthy();
    expect(screen.getByText('Models & Providers')).toBeTruthy();
    expect(screen.queryByText('Usage')).toBeNull();
    expect(screen.getByTestId('settings-header').className).toContain('bg-[var(--bg)]');

    await user.type(screen.getByRole('searchbox', { name: 'Search settings' }), 'push');

    expect(screen.getByText('Notifications')).toBeTruthy();
    expect(screen.queryByText('Models & Providers')).toBeNull();
  });

  it('opens a destination with its own URL and uses selects for multiple choices', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/settings']}><SettingsPage /></MemoryRouter>);

    await user.click(screen.getByTestId('settings-tab-appearance'));

    expect(await screen.findByTestId('settings-theme')).toBeTruthy();
    expect(screen.getByTestId('settings-font-size')).toBeTruthy();
    expect(screen.getByTestId('settings-tab-appearance').getAttribute('aria-current')).toBe('page');
  });

  it('uses a switch for an on/off setting', async () => {
    render(
      <MemoryRouter initialEntries={['/settings?section=notifications']}>
        <SettingsPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('switch', { name: /Notifications/ })).toBeTruthy();
  });
});
