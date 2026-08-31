// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SetupPage } from './setup-page';

const setup = vi.fn();
const acknowledgeSetup = vi.fn();
vi.mock('../services/auth', () => ({
  authService: {
    setup: (password: string) => setup(password) as Promise<unknown>,
    acknowledgeSetup: () => acknowledgeSetup() as Promise<unknown>,
  },
}));

const PASSWORD = 'correct horse battery';
const RECOVERY_KEY = 'ABCD-EFGH-JKMN-PQRS-TUVW-XYZ2';

function renderWizard() {
  return render(
    <MemoryRouter>
      <SetupPage />
    </MemoryRouter>,
  );
}

/** Plain DOM assertion: the repo does not carry jest-dom's matchers. */
function disabled(testId: string): boolean {
  return (screen.getByTestId(testId) as HTMLButtonElement).disabled;
}

afterEach(cleanup);

beforeEach(() => {
  setup.mockReset();
  acknowledgeSetup.mockReset();
  setup.mockResolvedValue({ recoveryKey: RECOVERY_KEY, token: 'token-1' });
  acknowledgeSetup.mockResolvedValue({ setupDone: true });
  localStorage.clear();
  sessionStorage.clear();
});

describe('setup wizard', () => {
  it('keeps Continue disabled until the passwords are long enough and match', async () => {
    const user = userEvent.setup();
    renderWizard();

    expect(disabled('setup-submit')).toBe(true);

    await user.type(screen.getByTestId('setup-password'), 'short');
    await user.type(screen.getByTestId('setup-password-confirm'), 'short');
    expect(disabled('setup-submit'), 'ten characters is the floor').toBe(true);

    await user.clear(screen.getByTestId('setup-password'));
    await user.clear(screen.getByTestId('setup-password-confirm'));
    await user.type(screen.getByTestId('setup-password'), PASSWORD);
    await user.type(screen.getByTestId('setup-password-confirm'), 'something else entirely');
    expect(disabled('setup-submit'), 'confirmation must match').toBe(true);

    await user.clear(screen.getByTestId('setup-password-confirm'));
    await user.type(screen.getByTestId('setup-password-confirm'), PASSWORD);
    expect(disabled('setup-submit')).toBe(false);
  });

  it('shows the recovery key once the account is created', async () => {
    const user = userEvent.setup();
    renderWizard();

    await user.type(screen.getByTestId('setup-password'), PASSWORD);
    await user.type(screen.getByTestId('setup-password-confirm'), PASSWORD);
    await user.click(screen.getByTestId('setup-submit'));

    await waitFor(() => expect(screen.getByTestId('setup-recovery-key')).toBeDefined());
    expect(screen.getByTestId('setup-recovery-key').textContent).toBe(RECOVERY_KEY);
    expect(setup).toHaveBeenCalledWith(PASSWORD);
  });

  it('will not move on until the key is acknowledged', async () => {
    const user = userEvent.setup();
    renderWizard();

    await user.type(screen.getByTestId('setup-password'), PASSWORD);
    await user.type(screen.getByTestId('setup-password-confirm'), PASSWORD);
    await user.click(screen.getByTestId('setup-submit'));
    await waitFor(() => expect(screen.getByTestId('setup-recovery-continue')).toBeDefined());

    expect(disabled('setup-recovery-continue')).toBe(true);

    await user.click(screen.getByTestId('setup-saved-key'));
    expect(disabled('setup-recovery-continue')).toBe(false);
    expect(acknowledgeSetup).not.toHaveBeenCalled();

    await user.click(screen.getByTestId('setup-recovery-continue'));
    await waitFor(() => expect(acknowledgeSetup).toHaveBeenCalledOnce());
  });

  it('reaches the provider step, which can still be skipped', async () => {
    const user = userEvent.setup();
    renderWizard();

    await user.type(screen.getByTestId('setup-password'), PASSWORD);
    await user.type(screen.getByTestId('setup-password-confirm'), PASSWORD);
    await user.click(screen.getByTestId('setup-submit'));
    await waitFor(() => expect(screen.getByTestId('setup-saved-key')).toBeDefined());
    await user.click(screen.getByTestId('setup-saved-key'));
    await user.click(screen.getByTestId('setup-recovery-continue'));

    await user.click(screen.getByTestId('setup-skip-provider'));
    await waitFor(() => expect(screen.getByTestId('setup-finish')).toBeDefined());
  });

  it('surfaces a server refusal instead of pretending it worked', async () => {
    setup.mockRejectedValue(new Error('boom'));
    const user = userEvent.setup();
    renderWizard();

    await user.type(screen.getByTestId('setup-password'), PASSWORD);
    await user.type(screen.getByTestId('setup-password-confirm'), PASSWORD);
    await user.click(screen.getByTestId('setup-submit'));

    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined());
    expect(screen.queryByTestId('setup-recovery-key')).toBeNull();
  });
});
