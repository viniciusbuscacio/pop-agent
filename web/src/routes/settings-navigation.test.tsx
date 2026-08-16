// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsPage } from './settings-page';
import { useFontStore } from '../store/font';
import { rememberLastActiveChat } from '../lib/last-active-chat';

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

afterEach(() => {
  cleanup();
  useFontStore.getState().setChoice('default');
  localStorage.removeItem('pop-agent.fontSize');
  sessionStorage.clear();
});

function CurrentLocation() {
  const location = useLocation();
  return <span data-testid="current-location">{`${location.pathname}${location.search}`}</span>;
}

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

  it('uses the wide desktop viewport without overflowing at Huge text', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/settings?section=appearance']}>
        <SettingsPage />
      </MemoryRouter>,
    );

    await user.selectOptions(screen.getByTestId('settings-font-size'), 'huge');

    expect(document.documentElement.style.fontSize).toBe('140%');
    expect(screen.getByTestId('settings-layout').className).toContain('md:w-[95%]');
    expect(screen.getByTestId('settings-layout').className).not.toContain('max-w-6xl');
    expect(screen.getByTestId('settings-content').className).toContain('max-w-full');
    expect(screen.getByTestId('settings-section-content').className).toContain('w-full');
    expect(screen.getByTestId('settings-section-content').className).not.toContain('max-w-3xl');
    expect(screen.getByTestId('settings-tab-model').textContent).toContain('Models & Providers');
  });

  it('returns a desktop detail directly to the chat that opened Settings', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: '/settings',
            search: '?section=appearance',
            state: { returnTo: '/chat/chat-open' },
          },
        ]}
      >
        <Routes>
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/chat/:chatId" element={<CurrentLocation />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId('settings-back-desktop').className).toContain('md:grid');
    expect(screen.getByTestId('settings-back-phone').className).toContain('md:hidden');
    await user.click(screen.getByTestId('settings-back-desktop'));

    expect(screen.getByTestId('current-location').textContent).toBe('/chat/chat-open');
  });

  it('falls back to the previously active chat when Settings has no route state', async () => {
    rememberLastActiveChat('chat-remembered');
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/settings?section=appearance']}>
        <Routes>
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/chat/:chatId" element={<CurrentLocation />} />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(screen.getByTestId('settings-back-desktop'));

    expect(screen.getByTestId('current-location').textContent).toBe('/chat/chat-remembered');
  });

  it('keeps the two-step Settings back path on a phone', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: '/settings',
            search: '?section=appearance',
            state: { returnTo: '/chat/chat-open' },
          },
        ]}
      >
        <Routes>
          <Route path="/settings" element={<><SettingsPage /><CurrentLocation /></>} />
          <Route path="/" element={<CurrentLocation />} />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(screen.getByTestId('settings-back-phone'));
    expect(screen.getByTestId('current-location').textContent).toBe('/settings');

    await user.click(screen.getByTestId('settings-back-phone'));
    expect(screen.getByTestId('current-location').textContent).toBe('/');
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
