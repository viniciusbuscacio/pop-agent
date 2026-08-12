// @vitest-environment happy-dom
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

const { updateStatus } = vi.hoisted(() => ({ updateStatus: vi.fn() }));

const SETTINGS: SettingsDTO = {
  language: 'en',
  defaultProvider: 'openrouter',
  defaultModel: 'test',
  customInstructions: '',
  voiceModel: 'base',
  voiceCleanup: false,
  voiceCleanupModel: '',
  autoSkillMode: 'disabled',
  distillIntervalMinutes: 10,
  autoActivatePreparedUpdates: false,
  autoRestartIdleMinutes: 10,
};

vi.mock('../services/settings', () => ({
  settingsService: {
    read: vi.fn(() => Promise.resolve(SETTINGS)),
    write: vi.fn(),
    updateStatus: () => updateStatus() as Promise<UpdateStatusResponse | undefined>,
  },
}));

beforeEach(() => {
  window.history.replaceState({}, '', '/settings?section=updates');
  vi.mocked(checkForUpdateNow).mockReset();
  vi.mocked(applyUpdate).mockReset().mockResolvedValue(undefined);
  updateStatus.mockReset().mockResolvedValue(undefined);
});

afterEach(cleanup);

describe('Settings PWA update action', () => {
  it('checks for a new worker and applies it with one button press', async () => {
    vi.mocked(checkForUpdateNow).mockResolvedValue('update-found');
    const user = userEvent.setup();
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);

    await user.click(await screen.findByTestId('update-check-now'));

    await waitFor(() => expect(applyUpdate).toHaveBeenCalledOnce());
    expect(screen.getByTestId('update-check-now').textContent).toBe('Updating PWA…');
  });

  it('does not reload when the installed PWA is already current', async () => {
    vi.mocked(checkForUpdateNow).mockResolvedValue('up-to-date');
    const user = userEvent.setup();
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);

    await user.click(await screen.findByTestId('update-check-now'));

    await screen.findByText('You are on the latest PWA version.');
    expect(applyUpdate).not.toHaveBeenCalled();
  });

  it('does not advertise an older published server tag as an update', async () => {
    updateStatus.mockResolvedValue({
      popAgent: { current: '0.2.14', latest: '0.2.0' },
      pi: { current: '0.84.1', latest: '0.84.1' },
      node: 'v22.0.0',
      environment: [],
      updateCommand: 'update',
    } satisfies UpdateStatusResponse);
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);

    await screen.findByText('Pop Agent is up to date.');
    expect(screen.queryByText('Pop Agent 0.2.0 is available.')).toBeNull();
  });

  it('advertises a strictly newer published server tag', async () => {
    updateStatus.mockResolvedValue({
      popAgent: { current: '0.2.14', latest: '0.3.0' },
      pi: { current: '0.84.1', latest: '0.84.1' },
      node: 'v22.0.0',
      environment: [],
      updateCommand: 'update',
    } satisfies UpdateStatusResponse);
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);

    await screen.findByText('Pop Agent 0.3.0 is available.');
  });
});
