// @vitest-environment happy-dom
import { settingsResources } from '../services/settings-resources';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SettingsDTO, UpdateStatusResponse } from '@pop-agent/shared';
import { SettingsPage } from './settings-page';
import { applyUpdate, checkForUpdateNow } from '../services/pwa-update';

vi.mock('../services/pwa-update', () => ({
  applyUpdate: vi.fn(),
  checkForUpdateNow: vi.fn(),
}));

const { updateStatus, writeSettings, preparePiCandidate, activatePiCandidate, restartWhenIdle, cancelRestart } = vi.hoisted(() => ({
  updateStatus: vi.fn(),
  writeSettings: vi.fn(),
  preparePiCandidate: vi.fn(),
  activatePiCandidate: vi.fn(),
  restartWhenIdle: vi.fn(),
  cancelRestart: vi.fn(),
}));

const SETTINGS: SettingsDTO = {
  language: 'en',
  defaultProvider: 'openrouter',
  defaultModel: 'test',
  customInstructions: '',
  voiceModel: 'base',
  voiceCleanup: false,
  voiceCleanupModel: '',
  autoSkillsEnabled: false,
  piUpdatePolicy: 'recommended',
};

vi.mock('../services/settings', () => ({
  settingsService: {
    read: vi.fn(() => Promise.resolve(SETTINGS)),
    update: (patch: Partial<SettingsDTO>) => writeSettings(patch) as Promise<SettingsDTO>,
    updateStatus: () => updateStatus() as Promise<UpdateStatusResponse | undefined>,
    preparePiCandidate: () => preparePiCandidate() as Promise<unknown>,
    activatePiCandidate: () => activatePiCandidate() as Promise<unknown>,
    restartWhenIdle: () => restartWhenIdle() as Promise<unknown>,
    cancelRestart: () => cancelRestart() as Promise<unknown>,
  },
}));

beforeEach(() => {
  settingsResources.clear();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  window.history.replaceState({}, '', '/settings?section=updates');
  vi.mocked(checkForUpdateNow).mockReset();
  vi.mocked(applyUpdate).mockReset().mockResolvedValue(undefined);
  updateStatus.mockReset().mockResolvedValue(undefined);
  writeSettings.mockReset().mockImplementation((patch: Partial<SettingsDTO>) =>
    Promise.resolve({ ...SETTINGS, ...patch }),
  );
  preparePiCandidate.mockReset().mockResolvedValue({
    ok: true,
    candidate: { phase: 'installing', version: '0.84.1' },
  });
  activatePiCandidate.mockReset().mockResolvedValue({
    ok: true,
    candidate: { phase: 'waiting-idle', version: '0.85.0' },
  });
  restartWhenIdle.mockReset().mockResolvedValue({
    ok: true,
    deployment: {
      runningCommit: 'old', headCommit: 'new', lastKnownGood: 'old',
      pending: true, clean: true, prepared: true, phase: 'waiting-idle', requestedBy: 'manual',
    },
  });
  cancelRestart.mockReset().mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Settings PWA update action', () => {
  it('checks for a new worker and applies it with one button press', async () => {
    vi.mocked(checkForUpdateNow).mockResolvedValue('update-found');
    const user = userEvent.setup();
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);

    await user.click(await screen.findByTestId('update-check-now'));

    await waitFor(() => expect(applyUpdate).toHaveBeenCalledOnce());
    expect(screen.getByTestId('update-check-result').textContent).toBe('Updating PWA…');
    expect((screen.getByTestId('update-check-now') as HTMLButtonElement).disabled).toBe(false);
  });

  it('does not reload when the installed PWA is already current', async () => {
    vi.mocked(checkForUpdateNow).mockResolvedValue('up-to-date');
    const user = userEvent.setup();
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);

    await user.click(await screen.findByTestId('update-check-now'));

    await screen.findByText('This app is up to date.');
    expect(applyUpdate).not.toHaveBeenCalled();
  });

  it('recovers the update button when applying the new worker fails', async () => {
    vi.mocked(checkForUpdateNow).mockResolvedValue('update-found');
    vi.mocked(applyUpdate).mockRejectedValue(new Error('reload failed'));
    const user = userEvent.setup();
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);

    await user.click(await screen.findByTestId('update-check-now'));

    expect(await screen.findByText('The app update could not be applied. Try again.')).toBeTruthy();
    expect((screen.getByTestId('update-check-now') as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows fixed automatic checks without a device toggle', async () => {
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);

    expect((await screen.findByTestId('updates-automatic-status')).textContent)
      .toContain('Every 10 minutes');
    expect(screen.getByText(/applied automatically/)).toBeTruthy();
    expect(screen.queryByTestId('updates-check-automatically')).toBeNull();
  });

  it('describes the server without assuming its operating system', async () => {
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);

    expect(await screen.findByText('Pop Agent running on your server.')).toBeTruthy();
    expect(screen.queryByText(/Linux server/)).toBeNull();
  });

  it('does not advertise an older published server tag as an update', async () => {
    updateStatus.mockResolvedValue({
      popAgent: { current: '0.2.15', latest: '0.2.0' },
      pi: { current: '0.84.1', recommended: '0.84.1', latest: '0.84.1' },
      node: 'v22.0.0',
      environment: [],
      updateCommand: 'update',
    } satisfies UpdateStatusResponse);
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);

    expect((await screen.findByTestId('update-server-available')).textContent).toContain('None');
    expect(screen.queryByText('0.2.0')).toBeNull();
  });

  it('advertises a strictly newer published server tag', async () => {
    updateStatus.mockResolvedValue({
      popAgent: { current: '0.2.15', latest: '0.3.0' },
      pi: { current: '0.84.1', recommended: '0.84.1', latest: '0.84.1' },
      node: 'v22.0.0',
      environment: [],
      updateCommand: 'update',
    } satisfies UpdateStatusResponse);
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);

    expect((await screen.findByTestId('update-server-available')).textContent).toContain('0.3.0');
  });

  it('shows pi versions, persists the policy, and prepares a runtime', async () => {
    updateStatus.mockResolvedValue({
      popAgent: { current: '0.2.30', latest: '0.2.30' },
      pi: { current: '0.84.1', recommended: '0.84.1', latest: '0.85.0' },
      node: 'v22.19.0',
      environment: [],
      updateCommand: 'update',
    } satisfies UpdateStatusResponse);
    const user = userEvent.setup();
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);

    await user.click(await screen.findByTestId('update-ai-runtime'));
    expect((await screen.findByTestId('update-pi-current')).textContent).toContain('0.84.1');
    expect(screen.getByTestId('update-pi-recommended').textContent).toContain('0.84.1');
    expect(screen.getByTestId('update-pi-latest').textContent).toContain('0.85.0');

    await user.selectOptions(screen.getByTestId('updates-pi-policy'), 'latest');
    await waitFor(() =>
      expect(writeSettings).toHaveBeenCalledWith({ piUpdatePolicy: 'latest' }),
    );
    expect(screen.getByText(/Candidates are validated in isolation/)).toBeTruthy();

    await user.click(screen.getByTestId('update-pi-prepare'));
    await waitFor(() => expect(preparePiCandidate).toHaveBeenCalledOnce());
  });

  it('offers manual activation only for a validated ready candidate', async () => {
    updateStatus.mockResolvedValue({
      popAgent: { current: '0.2.30', latest: '0.2.30' },
      pi: {
        current: '0.84.1', recommended: '0.85.0', latest: '0.85.0',
        candidate: { phase: 'ready', version: '0.85.0', integrity: 'sha512-x' },
      },
      node: 'v22.19.0', environment: [], updateCommand: 'update',
    } satisfies UpdateStatusResponse);
    const user = userEvent.setup();
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);

    await user.click(await screen.findByTestId('update-ai-runtime'));
    await user.click(await screen.findByTestId('update-pi-activate'));
    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(activatePiCandidate).toHaveBeenCalledOnce());
    expect(await screen.findByText(/Waiting for active work to finish/)).toBeTruthy();
  });

  it('confirms before scheduling activation of a prepared server build', async () => {
    updateStatus.mockResolvedValue({
      popAgent: { current: '0.2.41', latest: '0.2.41' },
      pi: { current: '0.84.1', recommended: '0.84.1' },
      node: 'v22.19.0', environment: [], updateCommand: 'update',
      deployment: {
        runningCommit: 'old', headCommit: 'new', lastKnownGood: 'old',
        pending: true, clean: true, prepared: true, phase: 'pending',
      },
    } satisfies UpdateStatusResponse);
    const user = userEvent.setup();
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);

    vi.mocked(window.confirm).mockReturnValueOnce(false);
    await user.click(await screen.findByTestId('update-restart-when-idle'));
    expect(restartWhenIdle).not.toHaveBeenCalled();

    vi.mocked(window.confirm).mockReturnValueOnce(true);
    await user.click(screen.getByTestId('update-restart-when-idle'));
    await waitFor(() => expect(restartWhenIdle).toHaveBeenCalledOnce());
  });

  it('can cancel a server restart while it is waiting for idle', async () => {
    const waiting: UpdateStatusResponse = {
      popAgent: { current: '0.2.41', latest: '0.2.41' },
      pi: { current: '0.84.1', recommended: '0.84.1' },
      node: 'v22.19.0',
      environment: [],
      updateCommand: 'update',
      deployment: {
        runningCommit: 'old', headCommit: 'new', lastKnownGood: 'old',
        pending: true, clean: true, prepared: true, phase: 'waiting-idle', requestedBy: 'manual',
      },
    };
    updateStatus
      .mockResolvedValueOnce(waiting)
      .mockResolvedValue({
        ...waiting,
        deployment: { ...waiting.deployment!, pending: false, phase: 'cancelled' },
      });
    const user = userEvent.setup();
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);

    await user.click(await screen.findByTestId('update-cancel-restart'));

    await waitFor(() => expect(cancelRestart).toHaveBeenCalledOnce());
    expect(await screen.findByText('The scheduled restart was cancelled.')).toBeTruthy();
  });
});
