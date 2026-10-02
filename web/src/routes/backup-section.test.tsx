// @vitest-environment happy-dom
import { settingsResources } from '../services/settings-resources';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackupSection } from './backup-section';

const list = vi.fn();
const remove = vi.fn();
const setPassword = vi.fn();
const restore = vi.fn();
const create = vi.fn();
const importArchive = vi.fn();

vi.mock('../services/backups', () => ({
  backupsService: {
    importArchive: (...args: unknown[]) => importArchive(...args) as Promise<unknown>,
    restore: (name: string, password?: string) => restore(name, password) as Promise<unknown>,
    setPassword: (password: string, confirmation: string) => setPassword(password, confirmation) as Promise<void>,
    list: () => list() as Promise<unknown>,
    create: (includeFiles: boolean) => create(includeFiles) as Promise<unknown>,
    download: vi.fn(),
    remove: (name: string) => remove(name) as Promise<unknown>,
  },
}));

beforeEach(() => {
  settingsResources.clear();
  list.mockReset().mockResolvedValue({
    backups: [{ name: 'backup-2026.tar.gz', size: 1024, createdAt: '2026-08-31T12:00:00Z' }],
  });
  importArchive.mockReset().mockResolvedValue({});
  create.mockReset().mockResolvedValue({});
  restore.mockReset().mockResolvedValue({ accepted: true });
  remove.mockReset().mockResolvedValue(undefined);
  setPassword.mockReset().mockResolvedValue(undefined);
  vi.spyOn(window, 'confirm').mockReturnValue(false);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('BackupSection', () => {
  it('requires configuration, allows cancellation and saves matching passwords without displaying them', async () => {
    const user = userEvent.setup();
    render(<BackupSection />);
    await screen.findByText('backup-2026.tar.gz');
    expect((screen.getByTestId('backup-create') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Legacy — not encrypted')).toBeTruthy();
    await user.click(screen.getByText('Set backup password'));
    await user.type(screen.getByLabelText('Backup password'), 'first-password');
    await user.click(screen.getByText('Cancel'));
    expect(setPassword).not.toHaveBeenCalled();
    await user.click(screen.getByText('Set backup password'));
    expect((screen.getByLabelText('Backup password') as HTMLInputElement).value).toBe('');
    await user.type(screen.getByLabelText('Backup password'), 'separate-password');
    await user.type(screen.getByLabelText('Confirm backup password'), 'separate-password');
    await user.click(screen.getByText('Save backup password'));
    await waitFor(() => expect(setPassword).toHaveBeenCalledWith('separate-password', 'separate-password'));
    expect(screen.queryByLabelText('Backup password')).toBeNull();
    expect((screen.getByTestId('backup-create') as HTMLButtonElement).disabled).toBe(false);
  });
  it('shows loading before an empty state and reports list failures', async () => {
    let rejectList: ((reason: Error) => void) | undefined;
    list.mockReturnValue(new Promise((_resolve, reject) => { rejectList = reject; }));
    render(<BackupSection />);

    expect(screen.getByText('Loading…')).toBeTruthy();
    expect(screen.queryByText('No backups yet.')).toBeNull();
    rejectList?.(new Error('offline'));

    expect(await screen.findByRole('alert')).toBeTruthy();
  });

  it('requires confirmation before deleting a backup', async () => {
    const user = userEvent.setup();
    render(<BackupSection />);
    await screen.findByText('backup-2026.tar.gz');

    await user.click(screen.getByText('Delete'));
    expect(remove).not.toHaveBeenCalled();

    vi.mocked(window.confirm).mockReturnValue(true);
    await user.click(screen.getByText('Delete'));
    await waitFor(() => expect(remove).toHaveBeenCalledWith('backup-2026.tar.gz'));
  });
});

it('opens an encrypted restore form, allows cancel and requires explicit confirmation', async () => {
  list.mockResolvedValue({ backups: [{ name: 'pop-backup-test.popbackup', encrypted: true, size: 1, createdAt: '2026-09-08' }], restoreAvailable: true });
  const user = userEvent.setup();
  render(<BackupSection />);
  await user.click(await screen.findByText('Restore'));
  await user.type(screen.getByLabelText('Password used for this backup'), 'archive-password');
  await user.click(screen.getByText('Cancel'));
  expect(restore).not.toHaveBeenCalled();
  await user.click(screen.getByText('Restore'));
  expect((screen.getByLabelText('Password used for this backup') as HTMLInputElement).value).toBe('');
  await user.type(screen.getByLabelText('Password used for this backup'), 'archive-password');
  await user.click(screen.getByText('Restore and restart'));
  expect(restore).not.toHaveBeenCalled();
  vi.mocked(window.confirm).mockReturnValue(true);
  await user.click(screen.getByText('Restore and restart'));
  await waitFor(() => expect(restore).toHaveBeenCalledWith('pop-backup-test.popbackup', 'archive-password'));
  expect(screen.queryByLabelText('Password used for this backup')).toBeNull();
  expect(screen.getByRole('status').textContent).toContain('background');
});

it('recovers a running operation when the page is reopened and disables conflicting actions', async () => {
  list.mockResolvedValue({ backups: [], passwordConfigured: true, operation: { state: 'creating' } });
  const { unmount } = render(<BackupSection />);
  expect((await screen.findByRole('status')).textContent).toContain('You can leave this page');
  unmount();
  render(<BackupSection />);
  await screen.findByRole('status');
  expect((screen.getByTestId('backup-create') as HTMLButtonElement).disabled).toBe(true);
});

it('includes Files by default and sends an explicit exclusion when the switch is off', async () => {
  list.mockResolvedValue({ backups: [], passwordConfigured: true, fileSelectionAvailable: true });
  const user = userEvent.setup();
  render(<BackupSection />);
  const toggle = await screen.findByRole('switch', { name: /Include files/ });
  await waitFor(() => expect((screen.getByTestId('backup-create') as HTMLButtonElement).disabled).toBe(false));
  expect((toggle as HTMLInputElement).checked).toBe(true);
  await user.click(screen.getByTestId('backup-create'));
  await waitFor(() => expect(create).toHaveBeenCalledWith(true));
  await user.click(toggle);
  await user.click(screen.getByTestId('backup-create'));
  await waitFor(() => expect(create).toHaveBeenCalledWith(false));
});

it('does not offer file exclusion before the connected server supports it', async () => {
  list.mockResolvedValue({ backups: [], passwordConfigured: true });
  render(<BackupSection />);
  const toggle = await screen.findByRole('switch', { name: /Include files/ });
  await screen.findByText('No backups yet.');
  expect((toggle as HTMLInputElement).disabled).toBe(true);
  expect((toggle as HTMLInputElement).checked).toBe(true);
});


it('imports a file in an empty installation without setting a new password or auto-restoring', async () => {
  list.mockResolvedValue({ backups: [], importMaxBytes: 10 * 1024 ** 3, restoreAvailable: true });
  const user = userEvent.setup(); render(<BackupSection />);
  await screen.findByText('No backups yet.');
  const file = new File(['POPBAK01' + 'x'.repeat(100)], 'original.popbackup');
  await user.upload(screen.getByLabelText('Backup archive'), file);
  await user.click(screen.getByText('Import backup'));
  await waitFor(() => expect(importArchive).toHaveBeenCalledWith(file, expect.any(AbortSignal), expect.any(Function)));
  expect(restore).not.toHaveBeenCalled(); expect(setPassword).not.toHaveBeenCalled();
  expect(await screen.findByText(/Backup imported/)).toBeTruthy();
});

it('cancels an in-flight import without restoring and reconciles the archive list', async () => {
  list.mockResolvedValue({ backups: [], importMaxBytes: 10 * 1024 ** 3 });
  importArchive.mockImplementation((_file: File, signal: AbortSignal, progress: (bytes: number) => void) => new Promise((_resolve, reject) => {
    progress(10);
    signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
  }));
  const user = userEvent.setup(); render(<BackupSection />);
  await screen.findByText('No backups yet.');
  await user.upload(screen.getByLabelText('Backup archive'), new File(['x'.repeat(100)], 'backup.popbackup'));
  await user.click(screen.getByText('Import backup'));
  await user.click(await screen.findByText('Cancel upload'));
  expect(await screen.findByText(/Upload cancelled/)).toBeTruthy();
  expect(restore).not.toHaveBeenCalled();
});
