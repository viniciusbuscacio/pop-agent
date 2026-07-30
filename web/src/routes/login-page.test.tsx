// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../services/api';
import { LoginPage } from './login-page';

const login = vi.fn();
vi.mock('../services/auth', () => ({
  authService: {
    login: (password: string) => login(password) as Promise<unknown>,
  },
}));

const PASSWORD = 'correct horse battery';

function renderLogin() {
  return render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  );
}

afterEach(cleanup);

beforeEach(() => {
  login.mockReset();
  localStorage.clear();
  sessionStorage.clear();
});

describe('login', () => {
  it('stores the token for the tab only by default', async () => {
    login.mockResolvedValue({ token: 'token-1' });
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByTestId('login-password'), PASSWORD);
    await user.click(screen.getByTestId('login-submit'));

    await waitFor(() => expect(sessionStorage.getItem('popy.token')).toBe('token-1'));
    expect(localStorage.getItem('popy.token'), 'not remembered across tabs').toBeNull();
  });

  it('remembers the session when asked to', async () => {
    login.mockResolvedValue({ token: 'token-2' });
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByTestId('login-password'), PASSWORD);
    await user.click(screen.getByTestId('login-keep-signed-in'));
    await user.click(screen.getByTestId('login-submit'));

    await waitFor(() => expect(localStorage.getItem('popy.token')).toBe('token-2'));
  });

  it('reports a wrong password inline and clears the field', async () => {
    login.mockRejectedValue(new ApiError('invalid_credentials', 'nope', 401));
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByTestId('login-password'), 'wrong password');
    await user.click(screen.getByTestId('login-submit'));

    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined());
    expect((screen.getByTestId('login-password') as HTMLInputElement).value).toBe('');
  });

  it('counts the lockout down instead of showing a frozen number', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    login.mockRejectedValue(new ApiError('locked', 'locked', 423, 30));
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByTestId('login-password'), PASSWORD);
    await user.click(screen.getByTestId('login-submit'));

    await waitFor(() => expect(screen.getByTestId('login-locked')).toBeDefined());
    expect(screen.getByTestId('login-locked').textContent).toContain('30');

    await vi.advanceTimersByTimeAsync(2000);
    await waitFor(() => expect(screen.getByTestId('login-locked').textContent).toContain('28'));

    // While locked, the form must not fire another attempt.
    expect((screen.getByTestId('login-submit') as HTMLButtonElement).disabled).toBe(true);
    vi.useRealTimers();
  });
});
