// @vitest-environment happy-dom
import { settingsResources } from '../services/settings-resources';
import { syncSetting } from '../services/settings-preload';
import { syncQueue } from '../services/sync-queue';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPage } from './settings-page';

vi.mock('../services/pwa-update', () => ({
  applyUpdate: vi.fn(),
  checkForUpdateNow: vi.fn(),
}));

const localAccessMocks = vi.hoisted(() => ({ machines: vi.fn(), setEnabled: vi.fn(), remove: vi.fn() }));
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
  syncQueue.stop();
  settingsResources.clear();
  window.history.replaceState({}, '', '/settings?section=installation');
  window.localStorage.clear();
  eventMocks.listeners.clear();
  eventMocks.resumeListeners.clear();
  localAccessMocks.machines.mockReset();
  localAccessMocks.setEnabled.mockReset();
  localAccessMocks.remove.mockReset().mockResolvedValue(undefined);
  localAccessMocks.machines.mockResolvedValue({ machines: [] });
  localAccessMocks.setEnabled.mockResolvedValue({ machineId: 'machine-m1', enabled: true });
});

afterEach(cleanup);

describe('Settings installation guide', () => {
  it('builds personal commands from the current server', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Device to install on' }), 'windows');
    expect(screen.getByTestId('installation-cli-windows').textContent).toContain(
      `powershell -c "irm ${window.location.origin}/install.ps1 | iex"`,
    );
    expect(screen.getByRole('heading', { name: 'Local computer access' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Download Windows installer' }).getAttribute('href')).toBe(
      `${window.location.origin}/local-access-installer?platform=windows&arch=amd64`,
    );
    expect(screen.getByTestId('installation-local-access-windows').textContent).toBe(
      `powershell -NoProfile -ExecutionPolicy Bypass -Command "irm '${window.location.origin}/install-local-access.ps1' | iex"`,
    );

    await user.selectOptions(screen.getByRole('combobox', { name: 'Device to install on' }), 'macos');
    expect(screen.getByTestId('installation-local-access-unix').textContent).toBe(
      `tmp="$(mktemp)"\ncurl -fsSL ${window.location.origin}/install-local-access.sh -o "$tmp" && bash "$tmp"; rm -f "$tmp"`,
    );
    expect(screen.queryByRole('link', { name: 'Download Windows installer' })).toBeNull();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Device to install on' }), 'linux');
    expect(screen.queryByTestId('installation-cli-windows')).toBeNull();
    expect(screen.getByTestId('installation-cli-unix').textContent).toContain(
      `curl -fsSL ${window.location.origin}/install.sh | sh`,
    );
    expect(screen.getByTestId('installation-cli-unix').textContent).toContain(
      `$HOME/.local/bin/pop login ${window.location.origin}`,
    );
    expect(screen.queryByTestId('installation-local-access-windows')).toBeNull();
    expect(screen.queryByTestId('installation-local-access-unix')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Local computer access' })).toBeNull();
    expect(localAccessMocks.machines).not.toHaveBeenCalled();
  });

  it('explains local computer access without platform jargon', async () => {
    window.history.replaceState({}, '', '/settings?section=devices');
    localAccessMocks.machines.mockResolvedValueOnce({
      machines: [{
        machineId: 'machine-m1', hostname: 'm1', platform: 'darwin', arch: 'arm64',
        clientVersion: '0.2.34', enabled: false, connected: true,
      }],
    });
    const user = userEvent.setup();
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);

    const toggle = await screen.findByRole('switch', { name: /Allow access to this computer/ });
    expect(screen.getByText(
      'Turn on access to let Pop Agent use files and run commands on that computer from this browser. Choose one computer at a time.',
    )).toBeTruthy();
    expect(screen.getByText('Mac — Online')).toBeTruthy();
    expect(document.body.textContent).not.toContain('darwin');
    expect(document.body.textContent).not.toContain('arm64');

    await user.click(toggle);

    expect(localAccessMocks.setEnabled).toHaveBeenCalledWith('machine-m1', true);
    expect(window.localStorage.getItem('pop-agent.local-machine-selection-v2')).toBe('machine-m1');
    expect(toggle).toHaveProperty('checked', true);
    expect(screen.queryByRole('combobox', { name: 'Use files from' })).toBeNull();
    expect(screen.getByText('Using m1')).toBeTruthy();
    await user.click(toggle);
    expect(localAccessMocks.setEnabled).toHaveBeenLastCalledWith('machine-m1', false);
    expect(window.localStorage.getItem('pop-agent.local-machine-selection-v2')).toBeNull();
    expect(toggle).toHaveProperty('checked', false);
    expect(screen.getByText('Server only')).toBeTruthy();
  });

  it('keeps an explicitly selected stable machine while its tray reconnects', async () => {
    window.history.replaceState({}, '', '/settings?section=devices');
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
    window.history.replaceState({}, '', '/settings?section=devices');
    window.localStorage.setItem('pop-agent.local-machine-selection-v2', 'machine-removed');
    localAccessMocks.machines.mockResolvedValueOnce({ machines: [] });

    render(<MemoryRouter><SettingsPage /></MemoryRouter>);

    await waitFor(() => {
      expect(window.localStorage.getItem('pop-agent.local-machine-selection-v2')).toBeNull();
    });
  });

  it('refreshes computer access from the shared SSE stream without polling', async () => {
    window.history.replaceState({}, '', '/settings?section=devices');
    const machine = {
      machineId: 'machine-m1', hostname: 'm1', platform: 'darwin', arch: 'arm64',
      clientVersion: '0.2.35', enabled: false, connected: true,
    };
    localAccessMocks.machines
      .mockResolvedValueOnce({ machines: [machine] })
      .mockResolvedValue({ machines: [{ ...machine, enabled: true }] });
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);
    const toggle = await screen.findByRole('switch', { name: /Allow access to this computer/ });
    expect(toggle).toHaveProperty('checked', false);

    await act(async () => {
      settingsResources.invalidate('devices');
      await syncSetting('devices');
    });

    await waitFor(() => expect(toggle).toHaveProperty('checked', false));
    expect(localAccessMocks.machines).toHaveBeenCalledTimes(2);
    expect((settingsResources.state('devices').data as { machines: { enabled: boolean }[] }).machines[0]?.enabled).toBe(true);
  });

  it('does not let an older machine snapshot overwrite a newer SSE refresh', async () => {
    window.history.replaceState({}, '', '/settings?section=devices');
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
      settingsResources.invalidate('devices');
      void syncSetting('devices');
    });
    await act(async () => resolveFirst({ machines: [machine] }));
    await waitFor(() => expect(localAccessMocks.machines).toHaveBeenCalledTimes(2));
    await act(async () => resolveSecond({ machines: [{ ...machine, enabled: true }] }));
    const toggle = await screen.findByRole('switch', { name: /Allow access to this computer/ });
    expect(toggle).toHaveProperty('checked', false);

    expect(toggle).toHaveProperty('checked', false);
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

    await user.selectOptions(screen.getByRole('combobox', { name: 'Device to install on' }), 'windows');
    await user.click(screen.getByTestId('installation-cli-windows-copy'));

    expect(writeText).toHaveBeenCalledWith(
      `powershell -c "irm ${window.location.origin}/install.ps1 | iex"`,
    );
    expect(screen.getByTestId('installation-cli-windows-copy').textContent).toBe('Copied');
  });
});

it('shows connection instructions only after Connect a computer and returns to Devices', async () => {
  window.history.replaceState({}, '', '/settings?section=devices');
  const user = userEvent.setup();
  render(<MemoryRouter><SettingsPage /></MemoryRouter>);
  expect(screen.queryByTestId('installation-local-access-windows')).toBeNull();
  expect(screen.queryByTestId('installation-server-url')).toBeNull();
  await user.click(screen.getByTestId('devices-connect'));
  await user.selectOptions(screen.getByRole('combobox', { name: 'Device to install on' }), 'windows');
  expect(screen.getByTestId('installation-local-access-windows').textContent).toContain(window.location.origin);
  await user.selectOptions(screen.getByRole('combobox', { name: 'Device to install on' }), 'linux');
  expect(screen.getByTestId('installation-local-access-unix').textContent).not.toContain('exit ');
  expect(screen.queryByTestId('installation-local-access-windows')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Back to Devices' }));
  expect(screen.getByTestId('devices-connect')).toBeTruthy();
  expect(screen.queryByTestId('installation-local-access-unix')).toBeNull();
});

it.each([
  ['ios', /iPhone or iPad: open in Safari/],
  ['android', /Android: open in Chrome/],
] as const)('shows %s instructions without desktop or local-access commands', async (platform, instructions) => {
  const user = userEvent.setup();
  render(<MemoryRouter><SettingsPage /></MemoryRouter>);
  await user.selectOptions(screen.getByRole('combobox', { name: 'Device to install on' }), platform);
  expect(screen.getByText(instructions)).toBeTruthy();
  expect(screen.queryByTestId('installation-cli-windows')).toBeNull();
  expect(screen.queryByTestId('installation-cli-unix')).toBeNull();
  expect(screen.queryByTestId('installation-local-access-windows')).toBeNull();
  expect(screen.queryByTestId('installation-local-access-unix')).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Local computer access' })).toBeNull();
  expect(screen.queryByTestId('pwa-install')).toBeNull();
});

it('requires confirmation to remove a computer and clears its selection after success', async () => {
  window.history.replaceState({}, '', '/settings?section=devices');
  window.localStorage.setItem('pop-agent.local-machine-selection-v2', 'machine-m1');
  localAccessMocks.machines.mockResolvedValue({ machines: [{ machineId: 'machine-m1', hostname: 'm1', platform: 'win32', enabled: true, connected: true }] });
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const user = userEvent.setup();
  render(<MemoryRouter><SettingsPage /></MemoryRouter>);
  await user.click(await screen.findByRole('button', { name: 'Remove computer' }));
  expect(localAccessMocks.remove).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  localAccessMocks.remove.mockRejectedValueOnce(new Error('offline'));
  await user.click(screen.getByRole('button', { name: 'Remove computer' }));
  await screen.findByRole('alert');
  expect(window.localStorage.getItem('pop-agent.local-machine-selection-v2')).toBe('machine-m1');
  await user.click(screen.getByRole('button', { name: 'Remove computer' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Remove computer' })).toBeNull());
  expect(localAccessMocks.remove).toHaveBeenCalledWith('machine-m1');
  expect(window.localStorage.getItem('pop-agent.local-machine-selection-v2')).toBeNull();
  confirm.mockRestore();
});

it('returns from Connect a computer using the parent breadcrumb and clears it on navigation', async () => {
  window.history.replaceState({}, '', '/settings');
  const user = userEvent.setup();
  render(<MemoryRouter initialEntries={['/settings?section=devices']}><SettingsPage /></MemoryRouter>);
  await user.click(await screen.findByRole('button', { name: 'Connect a computer' }));
  const trail = screen.getByRole('navigation', { name: 'Settings navigation' });
  expect(within(trail).getByText('Connect a computer').getAttribute('aria-current')).toBe('page');
  await user.click(within(trail).getByRole('button', { name: 'Devices' }));
  expect(screen.queryByRole('button', { name: 'Back to Devices' })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Connect a computer' }));
  await user.click(screen.getByTestId('settings-tab-appearance'));
  expect(within(trail).queryByText('Connect a computer')).toBeNull();
});

it('switches this browser between computers without revoking another computer', async () => {
  window.history.replaceState({}, '', '/settings?section=devices');
  window.localStorage.setItem('pop-agent.local-machine-selection-v2', 'machine-m1');
  localAccessMocks.machines.mockResolvedValue({ machines: [
    { machineId: 'machine-m1', hostname: 'm1', platform: 'darwin', enabled: true, connected: true },
    { machineId: 'machine-m2', hostname: 'm2', platform: 'win32', enabled: true, connected: false },
  ] });
  const user = userEvent.setup();
  render(<MemoryRouter><SettingsPage /></MemoryRouter>);
  const first = await screen.findByTestId('local-access-machine-m1');
  const second = screen.getByTestId('local-access-machine-m2');
  expect(first).toHaveProperty('checked', true);
  expect(second).toHaveProperty('checked', false);
  await user.click(second);
  expect(localAccessMocks.setEnabled).toHaveBeenCalledExactlyOnceWith('machine-m2', true);
  expect(first).toHaveProperty('checked', false);
  expect(second).toHaveProperty('checked', true);
  expect(window.localStorage.getItem('pop-agent.local-machine-selection-v2')).toBe('machine-m2');
  expect(screen.getByText('Using m2')).toBeTruthy();
});

it('keeps the previous selection on failed enable or disable and allows retry', async () => {
  window.history.replaceState({}, '', '/settings?section=devices');
  localAccessMocks.machines.mockResolvedValue({ machines: [
    { machineId: 'machine-m1', hostname: 'm1', platform: 'darwin', enabled: false, connected: true },
  ] });
  const user = userEvent.setup();
  render(<MemoryRouter><SettingsPage /></MemoryRouter>);
  const toggle = await screen.findByRole('switch', { name: /Allow access to this computer/ });
  localAccessMocks.setEnabled.mockRejectedValueOnce(new Error('offline'));
  await user.click(toggle);
  await screen.findByRole('alert');
  expect(toggle).toHaveProperty('checked', false);
  expect(window.localStorage.getItem('pop-agent.local-machine-selection-v2')).toBeNull();
  await user.click(toggle);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(toggle).toHaveProperty('checked', true);
  localAccessMocks.setEnabled.mockRejectedValueOnce(new Error('offline'));
  await user.click(toggle);
  await screen.findByRole('alert');
  expect(toggle).toHaveProperty('checked', true);
  expect(window.localStorage.getItem('pop-agent.local-machine-selection-v2')).toBe('machine-m1');
});
