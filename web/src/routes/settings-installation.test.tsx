// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { desktopSetupTicket } from '../services/installation';
import { SettingsPage } from './settings-page';

vi.mock('../services/pwa-update', () => ({
  applyUpdate: vi.fn(),
  checkForUpdateNow: vi.fn(),
}));

vi.mock('../services/installation', () => ({
  desktopSetupRelease: vi.fn().mockResolvedValue({
    version: '0.2.27', platform: 'darwin', arch: 'arm64', sha256: 'a'.repeat(64), size: 10 * 1024 * 1024,
  }),
  desktopSetupTicket: vi.fn().mockResolvedValue({
    downloadPath: '/desktop/setup/download?ticket=one-use', expiresInSeconds: 60,
  }),
}));

beforeEach(() => {
  window.history.replaceState({}, '', '/settings?section=installation');
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

  it('starts the authenticated Setup DMG download and copies this server address', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);

    const button = await screen.findByTestId('desktop-setup-download');
    await user.click(button);

    expect(writeText).toHaveBeenCalledWith(window.location.origin);
    expect(desktopSetupTicket).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
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
