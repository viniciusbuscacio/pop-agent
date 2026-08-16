// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ShellHeader } from './shell-header';

afterEach(cleanup);

function SettingsDestination() {
  const location = useLocation();
  const returnTo = (location.state as { returnTo?: string } | null)?.returnTo;
  return <span data-testid="settings-origin">{returnTo}</span>;
}

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
