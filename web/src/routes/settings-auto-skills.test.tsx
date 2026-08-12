// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SettingsDTO } from '@pop-agent/shared';
import { SettingsPage } from './settings-page';

const read = vi.fn();
const write = vi.fn();

vi.mock('../services/pwa-update', () => ({
  applyUpdate: vi.fn(),
  checkForUpdateNow: vi.fn(),
}));

vi.mock('../services/settings', () => ({
  settingsService: {
    read: () => read() as Promise<SettingsDTO>,
    write: (settings: SettingsDTO) => write(settings) as Promise<SettingsDTO>,
  },
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
  autoActivatePreparedUpdates: false,
  autoRestartIdleMinutes: 10,
};

beforeEach(() => {
  window.history.replaceState({}, '', '/settings?section=auto-skills');
  read.mockReset().mockResolvedValue(SETTINGS);
  write.mockReset().mockImplementation((settings: SettingsDTO) => Promise.resolve(settings));
});

afterEach(cleanup);

describe('Settings auto-skills section', () => {
  it('starts disabled with one product control', async () => {
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);

    await waitFor(() => {
      expect((screen.getByTestId('settings-auto-skills-enabled') as HTMLInputElement).checked).toBe(false);
    });
    expect(screen.queryByTestId('skills-distill-interval')).toBeNull();
  });

  it('enables the reviewed pipeline', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);

    await user.click(await screen.findByTestId('settings-auto-skills-enabled'));

    await waitFor(() => {
      expect(write).toHaveBeenCalledWith({ ...SETTINGS, autoSkillsEnabled: true });
      expect(screen.queryByTestId('skills-distill-interval')).toBeNull();
    });
  });
});
