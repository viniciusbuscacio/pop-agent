// @vitest-environment happy-dom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPage } from './settings-page';

vi.mock('../services/pwa-update', () => ({
  applyUpdate: vi.fn(),
  checkForUpdateNow: vi.fn(),
}));

const localAccessMocks = vi.hoisted(() => ({ machines: vi.fn(), setEnabled: vi.fn() }));
const eventMocks = vi.hoisted(() => ({
  listeners: new Set<(event: { kind: string }) => void>(),
  resumeListeners: new Set<() => void>(),
}));

vi.mock('../services/local-access', () => ({
  localAccessService: localAccessMocks,
}));

vi.mock('../services/events', () => ({
  eventStream: {
    subscribe: (listener: (event: { kind: string }) => void) => {
      eventMocks.listeners.add(listener);
      return () => eventMocks.listeners.delete(listener);
    },
    onResume: (listener: () => void) => {
      eventMocks.resumeListeners.add(listener);
      return () => eventMocks.resumeListeners.delete(listener);
    },
  },
}));

beforeEach(() => {
  window.history.replaceState({}, '', '/settings?section=installation');
  window.localStorage.clear();
  eventMocks.listeners.clear();
  eventMocks.resumeListeners.clear();
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
    expect(window.localStorage.getItem('pop-agent.local-machine-selection-v2')).toBeNull();
    expect(toggle).toHaveProperty('checked', true);

    const selector = await screen.findByRole('combobox', { name: 'Use files from' });
    expect(selector).toHaveProperty('value', '');
    await user.selectOptions(selector, 'machine-m1');
    expect(window.localStorage.getItem('pop-agent.local-machine-selection-v2')).toBe('machine-m1');
  });

  it('keeps an explicitly selected stable machine while its tray reconnects', async () => {
    window.localStorage.setItem('pop-agent.local-machine-selection-v2', 'machine-m1');
    localAccessMocks.machines.mockResolvedValueOnce({
      machines: [{
        machineId: 'machine-m1', hostname: 'm1', platform: 'win32', arch: 'x64',
        clientVersion: '0.2.35', enabled: true, connected: false,
      }],
    });

    render(<MemoryRouter><SettingsPage /></MemoryRouter>);

    await screen.findByText('Windows PC — Offline');
    expect(window.localStorage.getItem('pop-agent.local-machine-selection-v2')).toBe('machine-m1');
  });

  it('clears an unknown persisted stable machine during snapshot reconciliation', async () => {
    window.localStorage.setItem('pop-agent.local-machine-selection-v2', 'machine-removed');
    localAccessMocks.machines.mockResolvedValueOnce({ machines: [] });

    render(<MemoryRouter><SettingsPage /></MemoryRouter>);

    await waitFor(() => {
      expect(window.localStorage.getItem('pop-agent.local-machine-selection-v2')).toBeNull();
    });
  });

  it('refreshes computer access from the shared SSE stream without polling', async () => {
    const machine = {
      machineId: 'machine-m1', hostname: 'm1', platform: 'darwin', arch: 'arm64',
      clientVersion: '0.2.35', enabled: false, connected: true,
    };
    localAccessMocks.machines
      .mockResolvedValueOnce({ machines: [machine] })
      .mockResolvedValue({ machines: [{ ...machine, enabled: true }] });
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);
    const toggle = await screen.findByRole('switch', { name: /Allow access to files on m1/ });
    expect(toggle).toHaveProperty('checked', false);

    await act(async () => {
      for (const listener of eventMocks.listeners) listener({ kind: 'local-machines-changed' });
    });

    await waitFor(() => expect(toggle).toHaveProperty('checked', true));
    expect(localAccessMocks.machines).toHaveBeenCalledTimes(2);
  });

  it('does not let an older machine snapshot overwrite a newer SSE refresh', async () => {
    const machine = {
      machineId: 'machine-m1', hostname: 'm1', platform: 'darwin', arch: 'arm64',
      clientVersion: '0.2.35', enabled: false, connected: true,
    };
    let resolveFirst!: (value: { machines: (typeof machine)[] }) => void;
    let resolveSecond!: (value: { machines: (typeof machine)[] }) => void;
    localAccessMocks.machines
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);
    await waitFor(() => expect(localAccessMocks.machines).toHaveBeenCalledOnce());

    await act(async () => {
      for (const listener of eventMocks.listeners) listener({ kind: 'local-machines-changed' });
    });
    await waitFor(() => expect(localAccessMocks.machines).toHaveBeenCalledTimes(2));
    await act(async () => resolveSecond({ machines: [{ ...machine, enabled: true }] }));
    const toggle = await screen.findByRole('switch', { name: /Allow access to files on m1/ });
    expect(toggle).toHaveProperty('checked', true);

    await act(async () => resolveFirst({ machines: [machine] }));
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
