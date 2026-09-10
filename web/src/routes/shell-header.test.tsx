// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ShellFooter, ShellHeader } from './shell-header';

afterEach(cleanup);

function SettingsDestination() {
  const location = useLocation();
  const returnTo = (location.state as { returnTo?: string } | null)?.returnTo;
  return <span data-testid="settings-origin">{returnTo}</span>;
}

describe('Shell footer layout', () => {
  it('raises its desktop divider to align with the one-line composer', () => {
    render(
      <MemoryRouter>
        <ShellFooter />
      </MemoryRouter>,
    );

    const footer = screen.getByTestId('shell-footer');
    expect(footer.classList.contains('md:pt-4')).toBe(true);
    expect(footer.classList.contains('md:pb-3')).toBe(true);
  });
});

describe('Settings origin', () => {
  it('carries the selected chat through the Settings route', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/chat/chat-open']}>
        <Routes>
          <Route path="/chat/:chatId" element={<ShellHeader />} />
          <Route path="/settings" element={<SettingsDestination />} />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(screen.getByTestId('shell-settings'));

    expect(screen.getByTestId('settings-origin').textContent).toBe('/chat/chat-open');
  });
});
