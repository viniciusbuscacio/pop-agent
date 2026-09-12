// @vitest-environment happy-dom
import { settingsResources } from '../services/settings-resources';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SettingsDTO } from '@pop-agent/shared';
import { SettingsPage } from './settings-page';

const read = vi.fn();
const update = vi.fn();

vi.mock('../services/pwa-update', () => ({
  applyUpdate: vi.fn(),
  checkForUpdateNow: vi.fn(),
}));

vi.mock('../services/settings', () => ({
  settingsService: {
    read: () => read() as Promise<SettingsDTO>,
    update: (patch: Partial<SettingsDTO>) => update(patch) as Promise<SettingsDTO>,
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
  piUpdatePolicy: 'recommended',
};

beforeEach(() => {
  settingsResources.clear();
  window.history.replaceState({}, '', '/settings?section=auto-skills');
  read.mockReset().mockResolvedValue(SETTINGS);
  update.mockReset().mockImplementation((patch: Partial<SettingsDTO>) =>
    Promise.resolve({ ...SETTINGS, ...patch }),
  );
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
      expect(update).toHaveBeenCalledWith({ autoSkillsEnabled: true });
      expect(screen.queryByTestId('skills-distill-interval')).toBeNull();
    });
  });
});
