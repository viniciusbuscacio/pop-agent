// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPage } from './settings-page';

vi.mock('../services/pwa-update', () => ({
  applyUpdate: vi.fn(),
  checkForUpdateNow: vi.fn(),
}));

const connectionsMock = vi.hoisted(() => vi.fn());

vi.mock('../services/local-access', () => ({
  localAccessService: { connections: connectionsMock },
}));

beforeEach(() => {
  window.history.replaceState({}, '', '/settings?section=installation');
  window.localStorage.clear();
  connectionsMock.mockResolvedValue({ connections: [] });
});

afterEach(cleanup);

describe('Settings installation guide', () => {
  it('builds personal commands from the current server', async () => {
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);

    expect(screen.getByTestId('installation-cli-windows').textContent).toContain(
      `powershell -c "irm ${window.location.origin}/install.ps1 | iex"`,
    );
    expect(screen.getByTestId('installation-cli-unix').textContent).toContain(
      `curl -fsSL ${window.location.origin}/install.sh | sh`,
    );
    expect(screen.getByTestId('installation-cli-unix').textContent).toContain(
      `$HOME/.local/bin/pop login ${window.location.origin}`,
    );
    expect(screen.getByTestId('installation-local-access-unix').textContent).not.toContain('status=$?');
    expect(screen.getByTestId('installation-local-access-unix').textContent).not.toContain('exit ');
  });

  it('explains local computer access without platform jargon', async () => {
    connectionsMock.mockResolvedValue({
      connections: [
        {
          id: 'mac-terminal',
          role: 'interactive',
          machine: {
            machineId: 'machine-m1',
            hostname: 'm1',
            platform: 'darwin',
            arch: 'arm64',
            clientVersion: '0.2.34',
          },
        },
        {
          id: 'mac-connection',
          role: 'background',
          machine: {
            machineId: 'machine-m1',
            hostname: 'm1',
            platform: 'darwin',
            arch: 'arm64',
            clientVersion: '0.2.34',
          },
        },
      ],
    });
    const user = userEvent.setup();
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);

    const select = await screen.findByLabelText('Allow access to');
    expect(screen.getByText(
      'Install this package and enable it if you want Pop Agent to access and edit files on this computer. It is disabled by default.',
    )).toBeTruthy();
    expect(select.textContent).toContain('Disabled — server only');
    expect(screen.getAllByRole('option', { name: 'm1 — Mac (connected)' })).toHaveLength(1);
    expect(select.textContent).not.toContain('darwin');
    expect(select.textContent).not.toContain('arm64');

    await user.selectOptions(select, 'machine-m1');

    expect(window.localStorage.getItem('pop-agent.local-connection')).toBe('machine-m1');
    expect(screen.getByText('Enabled — Pop Agent can access and edit files on m1.')).toBeTruthy();
  });

  it('opens the browser-owned PWA installation prompt', async () => {
    const user = userEvent.setup();
    const prompt = vi.fn().mockResolvedValue(undefined);
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt,
      userChoice: Promise.resolve({ outcome: 'dismissed' as const }),
    });
    window.dispatchEvent(event);
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);

    await user.click(screen.getByTestId('pwa-install'));

    expect(event.defaultPrevented).toBe(true);
    expect(prompt).toHaveBeenCalledOnce();
    expect(screen.getByTestId('pwa-install-dismissed').textContent).toContain('canceled');
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
