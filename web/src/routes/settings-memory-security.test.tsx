// @vitest-environment happy-dom
import { settingsResources } from '../services/settings-resources';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPage } from './settings-page';

vi.mock('../services/pwa-update', () => ({
  applyUpdate: vi.fn(),
  checkForUpdateNow: vi.fn(),
}));

const { readMemory, writeMemory, restoreMemory, listPasskeys, removePasskey, signOutOthers } = vi.hoisted(() => ({
  readMemory: vi.fn(),
  writeMemory: vi.fn(),
  restoreMemory: vi.fn(),
  listPasskeys: vi.fn(),
  removePasskey: vi.fn(),
  signOutOthers: vi.fn(),
}));

vi.mock('../services/auth', () => ({
  authService: {
    signOutOthers: () => signOutOthers() as Promise<unknown>,
  },
}));

vi.mock('../services/settings', () => ({
  settingsService: {
    readMemory: () => readMemory() as Promise<unknown>,
    writeMemory: (doc: string) => writeMemory(doc) as Promise<unknown>,
    restoreMemory: () => restoreMemory() as Promise<unknown>,
  },
}));

vi.mock('../services/passkey', () => ({
  passkeyService: {
    supported: () => true,
    list: () => listPasskeys() as Promise<unknown>,
    register: vi.fn(),
    remove: (id: string) => removePasskey(id) as Promise<unknown>,
  },
}));

beforeEach(() => {
  settingsResources.clear();
  sessionStorage.clear();
  readMemory.mockReset().mockResolvedValue({ doc: 'Known fact', hasBackup: true });
  writeMemory.mockReset();
  restoreMemory.mockReset().mockResolvedValue({ doc: 'Previous fact', hasBackup: false });
  listPasskeys.mockReset().mockResolvedValue({
    credentials: [{ id: 'credential-1', label: 'MacBook Touch ID' }],
  });
  removePasskey.mockReset().mockResolvedValue(undefined);
  signOutOthers.mockReset().mockResolvedValue({ token: 'replacement-token' });
  vi.spyOn(window, 'confirm').mockReturnValue(false);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Settings destructive and reversible controls', () => {
  it('can cancel memory edits and confirms before restoring the backup', async () => {
    window.history.replaceState({}, '', '/settings?section=memory');
    const user = userEvent.setup();
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);

    const editor = (await screen.findByTestId('settings-memory')) as HTMLTextAreaElement;
    await user.clear(editor);
    await user.type(editor, 'Unsaved edit');
    await user.click(screen.getByTestId('settings-memory-cancel'));
    expect(editor.value).toBe('Known fact');

    await user.click(screen.getByTestId('settings-memory-restore'));
    expect(restoreMemory).not.toHaveBeenCalled();

    vi.mocked(window.confirm).mockReturnValue(true);
    await user.click(screen.getByTestId('settings-memory-restore'));
    await waitFor(() => expect(restoreMemory).toHaveBeenCalledOnce());
    expect(editor.value).toBe('Previous fact');
  });

  it('labels passkey removal accurately and requires confirmation', async () => {
    window.history.replaceState({}, '', '/settings?section=security');
    const user = userEvent.setup();
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);

    const remove = await screen.findByText('Remove passkey');
    await user.click(remove);
    expect(removePasskey).not.toHaveBeenCalled();

    vi.mocked(window.confirm).mockReturnValue(true);
    await user.click(remove);
    await waitFor(() => expect(removePasskey).toHaveBeenCalledWith('credential-1'));
  });

  it('confirms before invalidating every other session', async () => {
    window.history.replaceState({}, '', '/settings?section=security');
    const user = userEvent.setup();
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);

    await user.click(await screen.findByTestId('settings-sign-out-others'));
    expect(signOutOthers).not.toHaveBeenCalled();

    vi.mocked(window.confirm).mockReturnValue(true);
    await user.click(screen.getByTestId('settings-sign-out-others'));
    await waitFor(() => expect(signOutOthers).toHaveBeenCalledOnce());
  });
});
