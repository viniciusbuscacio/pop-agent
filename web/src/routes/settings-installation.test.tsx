// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AboutResponse } from '@pop-agent/shared';
import { SettingsPage } from './settings-page';

const { about } = vi.hoisted(() => ({ about: vi.fn() }));

vi.mock('../services/pwa-update', () => ({
  applyUpdate: vi.fn(),
  checkForUpdateNow: vi.fn(),
}));

vi.mock('../services/settings', () => ({
  settingsService: {
    about: () => about() as Promise<AboutResponse>,
  },
}));

beforeEach(() => {
  window.history.replaceState({}, '', '/settings?section=installation');
  about.mockReset().mockResolvedValue({
    popAgentVersion: '0.2.16',
    nodeVersion: 'v22.19.0',
    piVersion: '0.84.1',
  } satisfies AboutResponse);
});

afterEach(cleanup);

describe('Settings installation guide', () => {
  it('builds personal commands from the current server', async () => {
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);

    expect(screen.getByTestId('installation-cli-windows').textContent).toContain(
      `powershell -c "irm ${window.location.origin}/install.ps1 | iex"`,
    );
    await waitFor(() => {
      expect(screen.getByTestId('installation-cli-unix').textContent).toContain(
        `${window.location.origin}/cli-0.2.16.tgz`,
      );
    });
  });

  it('copies the Windows bootstrap command', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);

    await user.click(screen.getByTestId('installation-cli-windows-copy'));

    expect(writeText).toHaveBeenCalledWith(
      `powershell -c "irm ${window.location.origin}/install.ps1 | iex"`,
    );
    expect(screen.getByTestId('installation-cli-windows-copy').textContent).toBe('Copied');
  });
});
