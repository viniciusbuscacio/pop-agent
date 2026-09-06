// @vitest-environment happy-dom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupNavigation } from '../services/setup-navigation';
import { SetupPage } from './setup-page';

const setup = vi.fn();
const acknowledgeSetup = vi.fn();
const authState = vi.fn();
const onboardingPublic = vi.fn();
const onboardingPair = vi.fn();
const onboardingState = vi.fn();
const onboardingConnect = vi.fn();
const onboardingHttps = vi.fn();
vi.mock('../services/providers', () => ({
  normalizeBaseUrl: (value: string) => value,
  providersService: { list: () => Promise.resolve({ providers: [] }) },
}));
vi.mock('../services/auth', () => ({
  authService: {
    state: () => authState() as Promise<unknown>,
    setup: (password: string) => setup(password) as Promise<unknown>,
    acknowledgeSetup: () => acknowledgeSetup() as Promise<unknown>,
  },
}));
vi.mock('../services/onboarding', () => ({
  onboardingSession: {
    read: () => sessionStorage.getItem('test-onboarding') ?? undefined,
    write: (token: string) => sessionStorage.setItem('test-onboarding', token),
    clear: () => sessionStorage.removeItem('test-onboarding'),
  },
  onboardingService: {
    publicState: () => onboardingPublic() as Promise<unknown>,
    pair: (code: string) => onboardingPair(code) as Promise<unknown>,
    state: (token: string) => onboardingState(token) as Promise<unknown>,
    connect: (token: string) => onboardingConnect(token) as Promise<unknown>,
    enableHttps: (token: string, accepted: boolean, hostname?: string) =>
      onboardingHttps(token, accepted, hostname) as Promise<unknown>,
  },
}));

const PASSWORD = 'correct horse battery';
const RECOVERY_KEY = 'ABCD-EFGH-JKMN-PQRS-TUVW-XYZ2';

async function renderWizard() {
  const rendered = render(
    <MemoryRouter>
      <SetupPage />
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByTestId('setup-password')).toBeDefined());
  return rendered;
}

/** Plain DOM assertion: the repo does not carry jest-dom's matchers. */
function disabled(testId: string): boolean {
  return (screen.getByTestId(testId) as HTMLButtonElement).disabled;
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

beforeEach(() => {
  setup.mockReset();
  acknowledgeSetup.mockReset();
  authState.mockReset();
  authState.mockResolvedValue({ setupDone: false, setupMode: 'account' });
  onboardingPublic.mockReset();
  onboardingPair.mockReset();
  onboardingState.mockReset();
  onboardingConnect.mockReset();
  onboardingHttps.mockReset();
  onboardingPublic.mockResolvedValue({ required: true, phase: 'pairing' });
  setup.mockResolvedValue({ recoveryKey: RECOVERY_KEY, token: 'token-1' });
  acknowledgeSetup.mockResolvedValue({ setupDone: true });
  localStorage.clear();
  sessionStorage.clear();
});

describe('setup wizard', () => {
  it('retries a failed state lookup while showing Working', async () => {
    authState.mockRejectedValueOnce(new Error('temporary')).mockResolvedValue({ setupDone: false, setupMode: 'account' });
    render(<MemoryRouter><SetupPage /></MemoryRouter>);
    expect(await screen.findByText('Working…')).toBeDefined();
    await waitFor(() => expect(screen.getByTestId('setup-password')).toBeDefined(), { timeout: 3000 });
  });
  it('offers a working retry after exhausting automatic attempts', async () => {
    vi.useFakeTimers();
    try {
      authState.mockRejectedValue(new Error('temporary'));
      render(<MemoryRouter><SetupPage /></MemoryRouter>);
      await act(async () => { await vi.advanceTimersByTimeAsync(11000); });
      expect(screen.getByTestId('setup-state-retry')).toBeDefined();
      authState.mockResolvedValue({ setupDone: false, setupMode: 'account' });
      await act(async () => { screen.getByTestId('setup-state-retry').click(); });
      expect(screen.getByTestId('setup-password')).toBeDefined();
    } finally { vi.useRealTimers(); }
  });

  it('uses HTTP only to pair and prepare Tailscale, without rendering a password field', async () => {
    authState.mockResolvedValue({ setupDone: false, setupMode: 'network' });
    onboardingPair.mockResolvedValue({
      token: 'onboarding-token',
      state: {
        required: true,
        phase: 'tailscale',
        tailscaleInstalled: true,
        tailscaleConnected: false,
      },
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <SetupPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId('onboarding-code')).toBeDefined());
    expect(screen.queryByTestId('setup-password')).toBeNull();
    await user.type(screen.getByTestId('onboarding-code'), 'ABCD-EFGH-JKMN');
    await user.click(screen.getByTestId('onboarding-pair'));
    await waitFor(() => expect(screen.getByTestId('onboarding-connect')).toBeDefined());
    expect(onboardingPair).toHaveBeenCalledWith('ABCD-EFGH-JKMN');
  });

  async function renderNetwork() {
    authState.mockResolvedValue({ setupDone: false, setupMode: 'network' });
    sessionStorage.setItem('test-onboarding', 'paired');
    onboardingState.mockResolvedValue({ required: true, phase: 'tailscale' });
    const rendered = render(<MemoryRouter><SetupPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId('onboarding-connect')).toBeDefined());
    return rendered;
  }

  function signInTab() {
    const tab = { opener: {}, closed: false, document: { title: '', body: { textContent: '' } }, location: { replace: vi.fn() }, close: vi.fn() };
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    return tab;
  }

  it('opens sign-in automatically from one click after asynchronous server preparation', async () => {
    const tab = signInTab();
    let finish!: (value: unknown) => void;
    onboardingConnect.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await renderNetwork();
    await userEvent.setup().click(screen.getByTestId('onboarding-connect'));
    expect(window.open).toHaveBeenCalledOnce();
    expect(onboardingConnect).toHaveBeenCalledWith('paired');
    expect(disabled('onboarding-connect')).toBe(true);
    expect(tab.location.replace).not.toHaveBeenCalled();
    finish({ required: true, phase: 'tailscale', loginUrl: 'https://login.tailscale.com/a/test' });
    await waitFor(() => expect(tab.location.replace).toHaveBeenCalledWith('https://login.tailscale.com/a/test'));
    expect(tab.close).not.toHaveBeenCalled();
  });

  it('closes the reserved tab on failure and allows a retry', async () => {
    const tab = signInTab(); onboardingConnect.mockRejectedValue(new Error('offline'));
    await renderNetwork(); await userEvent.setup().click(screen.getByTestId('onboarding-connect'));
    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined());
    expect(tab.close).toHaveBeenCalledOnce(); expect(disabled('onboarding-connect')).toBe(false);
    expect(tab.location.replace).not.toHaveBeenCalled();
  });

  it('closes the waiting tab if Tailscale is already connected', async () => {
    const tab = signInTab(); onboardingConnect.mockResolvedValue({ required: true, phase: 'https' });
    await renderNetwork(); await userEvent.setup().click(screen.getByTestId('onboarding-connect'));
    await waitFor(() => expect(screen.getByTestId('onboarding-enable-https')).toBeDefined());
    expect(tab.close).toHaveBeenCalledOnce(); expect(tab.location.replace).not.toHaveBeenCalled();
  });

  it('does not navigate after leaving setup while preparation is pending', async () => {
    const tab = signInTab(); let finish!: (value: unknown) => void;
    onboardingConnect.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const rendered = await renderNetwork(); await userEvent.setup().click(screen.getByTestId('onboarding-connect'));
    rendered.unmount(); expect(tab.close).toHaveBeenCalledOnce();
    finish({ required: true, phase: 'tailscale', loginUrl: 'https://login.tailscale.com/a/test' });
    await Promise.resolve(); expect(tab.location.replace).not.toHaveBeenCalled();
  });

  it('redirects directly after Enable HTTPS succeeds, without another click', async () => {
    const navigate = vi.spyOn(setupNavigation, 'replace').mockImplementation(() => undefined);
    authState.mockResolvedValue({ setupDone: false, setupMode: 'network' });
    sessionStorage.setItem('test-onboarding', 'paired');
    onboardingState.mockResolvedValue({ required: true, phase: 'https' });
    onboardingHttps.mockResolvedValue({ required: true, phase: 'secure', secureUrl: 'https://pop.tail123.ts.net' });
    render(<MemoryRouter><SetupPage /></MemoryRouter>);
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('onboarding-certificate-notice'));
    expect(navigate).not.toHaveBeenCalled();
    await user.click(screen.getByTestId('onboarding-enable-https'));
    await waitFor(() => expect(navigate).toHaveBeenCalledExactlyOnceWith('https://pop.tail123.ts.net/setup'));
    expect(screen.queryByTestId('setup-password')).toBeNull();
    expect(screen.queryByText('Private HTTPS is ready')).toBeNull();
  });

  it('automatically continues an already-secure unpaired HTTP browser', async () => {
    const navigate = vi.spyOn(setupNavigation, 'replace').mockImplementation(() => { throw new Error('blocked'); });
    authState.mockResolvedValue({ setupDone: false, setupMode: 'network' });
    onboardingPublic.mockResolvedValue({ required: true, phase: 'secure', secureUrl: 'https://pop.tail123.ts.net' });
    render(<MemoryRouter><SetupPage /></MemoryRouter>);
    await waitFor(() => expect(navigate).toHaveBeenCalledExactlyOnceWith('https://pop.tail123.ts.net/setup'));
    await waitFor(() => expect(screen.getByTestId('onboarding-secure-link').getAttribute('href')).toBe('https://pop.tail123.ts.net/setup'));
  });

  it('shows animated progress while the server verifies HTTPS', async () => {
    const navigate = vi.spyOn(setupNavigation, 'replace').mockImplementation(() => undefined);
    let finish!: (value: unknown) => void;
    onboardingHttps.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    authState.mockResolvedValue({ setupDone: false, setupMode: 'network' });
    sessionStorage.setItem('test-onboarding', 'paired');
    onboardingState.mockResolvedValue({ required: true, phase: 'https' });
    render(<MemoryRouter><SetupPage /></MemoryRouter>);
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('onboarding-certificate-notice'));
    await user.click(screen.getByTestId('onboarding-enable-https'));
    await screen.findByTestId('onboarding-https-loading');
    expect(screen.getByTestId('working-indicator')).toBeDefined();
    expect(screen.getByText('Working…')).toBeDefined();
    expect(navigate).not.toHaveBeenCalled();
    finish({ required: true, phase: 'secure', secureUrl: 'https://pop.tail123.ts.net' });
    await waitFor(() => expect(navigate).toHaveBeenCalledExactlyOnceWith('https://pop.tail123.ts.net/setup'));
  });

  it('offers retry without refresh when navigation is blocked', async () => {
    const navigate = vi.spyOn(setupNavigation, 'replace')
      .mockImplementationOnce(() => { throw new Error('blocked'); })
      .mockImplementation(() => undefined);
    authState.mockResolvedValue({ setupDone: false, setupMode: 'network' });
    onboardingPublic.mockResolvedValue({ required: true, phase: 'secure', secureUrl: 'https://pop.tail123.ts.net' });
    render(<MemoryRouter><SetupPage /></MemoryRouter>);
    await userEvent.setup().click(await screen.findByTestId('onboarding-retry-https'));
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(2));
  });

  it('stays on the HTTPS activation step when activation fails', async () => {
    const navigate = vi.spyOn(setupNavigation, 'replace').mockImplementation(() => undefined);
    authState.mockResolvedValue({ setupDone: false, setupMode: 'network' });
    sessionStorage.setItem('test-onboarding', 'paired');
    onboardingState.mockResolvedValue({ required: true, phase: 'https' });
    onboardingHttps.mockRejectedValue(new Error('not ready'));
    render(<MemoryRouter><SetupPage /></MemoryRouter>);
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('onboarding-certificate-notice'));
    await user.click(screen.getByTestId('onboarding-enable-https'));
    await screen.findByRole('alert'); expect(navigate).not.toHaveBeenCalled();
  });

  it('keeps Continue disabled until the passwords are long enough and match', async () => {
    const user = userEvent.setup();
    await renderWizard();

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
    await renderWizard();

    await user.type(screen.getByTestId('setup-password'), PASSWORD);
    await user.type(screen.getByTestId('setup-password-confirm'), PASSWORD);
    await user.click(screen.getByTestId('setup-submit'));

    await waitFor(() => expect(screen.getByTestId('setup-recovery-key')).toBeDefined());
    expect(screen.getByTestId('setup-recovery-key').textContent).toBe(RECOVERY_KEY);
    expect(setup).toHaveBeenCalledWith(PASSWORD);
  });

  it('will not move on until the key is acknowledged', async () => {
    const user = userEvent.setup();
    await renderWizard();

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
    await renderWizard();

    await user.type(screen.getByTestId('setup-password'), PASSWORD);
    await user.type(screen.getByTestId('setup-password-confirm'), PASSWORD);
    await user.click(screen.getByTestId('setup-submit'));
    await waitFor(() => expect(screen.getByTestId('setup-saved-key')).toBeDefined());
    await user.click(screen.getByTestId('setup-saved-key'));
    await user.click(screen.getByTestId('setup-recovery-continue'));

    await user.click(await screen.findByTestId('setup-skip-provider'));
    await waitFor(() => expect(screen.getByTestId('setup-finish')).toBeDefined());
  });

  it('surfaces a server refusal instead of pretending it worked', async () => {
    setup.mockRejectedValue(new Error('boom'));
    const user = userEvent.setup();
    await renderWizard();

    await user.type(screen.getByTestId('setup-password'), PASSWORD);
    await user.type(screen.getByTestId('setup-password-confirm'), PASSWORD);
    await user.click(screen.getByTestId('setup-submit'));

    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined());
    expect(screen.queryByTestId('setup-recovery-key')).toBeNull();
  });
});
