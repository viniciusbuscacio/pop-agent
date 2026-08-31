// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackupSection } from './backup-section';

const list = vi.fn();
const remove = vi.fn();

vi.mock('../services/backups', () => ({
  backupsService: {
    list: () => list() as Promise<unknown>,
    create: vi.fn(),
    download: vi.fn(),
    remove: (name: string) => remove(name) as Promise<unknown>,
  },
}));

beforeEach(() => {
  list.mockReset().mockResolvedValue({
    backups: [{ name: 'backup-2026.tar.gz', size: 1024, createdAt: '2026-08-31T12:00:00Z' }],
  });
  remove.mockReset().mockResolvedValue(undefined);
  vi.spyOn(window, 'confirm').mockReturnValue(false);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('BackupSection', () => {
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
