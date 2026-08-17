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

const localAccessMocks = vi.hoisted(() => ({ machines: vi.fn(), setEnabled: vi.fn() }));

vi.mock('../services/local-access', () => ({
  localAccessService: localAccessMocks,
}));

beforeEach(() => {
  window.history.replaceState({}, '', '/settings?section=installation');
  window.localStorage.clear();
  localAccessMocks.machines.mockReset();
  localAccessMocks.setEnabled.mockReset();
  localAccessMocks.machines.mockResolvedValue({ machines: [] });
  localAccessMocks.setEnabled.mockResolvedValue({ machineId: 'machine-m1', enabled: true });
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
    localAccessMocks.machines.mockResolvedValueOnce({
      machines: [{
        machineId: 'machine-m1', hostname: 'm1', platform: 'darwin', arch: 'arm64',
        clientVersion: '0.2.34', enabled: false, connected: true,
      }],
    });
    const user = userEvent.setup();
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);

    const toggle = await screen.findByRole('switch', { name: /Allow access to files on m1/ });
    expect(screen.getByText(
      'Install this package and enable it if you want Pop Agent to access and edit files on this computer. It is disabled by default.',
    )).toBeTruthy();
    expect(screen.getByText('Mac — Online')).toBeTruthy();
    expect(document.body.textContent).not.toContain('darwin');
    expect(document.body.textContent).not.toContain('arm64');

    await user.click(toggle);

    expect(localAccessMocks.setEnabled).toHaveBeenCalledWith('machine-m1', true);
    expect(window.localStorage.getItem('pop-agent.local-connection')).toBe('machine-m1');
    expect(toggle).toHaveProperty('checked', true);
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
