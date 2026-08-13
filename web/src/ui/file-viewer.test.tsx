/** @vitest-environment happy-dom */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { viewUrl } = vi.hoisted(() => ({
  viewUrl: vi.fn<(path: string) => Promise<string>>(),
}));
vi.mock('../services/artifacts', () => ({ filesService: { viewUrl } }));

import { FileViewer } from './file-viewer';

afterEach(() => {
  cleanup();
  viewUrl.mockReset();
});

describe('FileViewer', () => {
  it('loads the inline file inside the PWA instead of opening a popup', async () => {
    viewUrl.mockResolvedValue('data:text/plain,note');
    const open = vi.spyOn(window, 'open');

    render(<FileViewer path="note.md" name="note.md" onClose={() => undefined} />);

    const frame = await screen.findByTitle('note.md');
    expect(frame.getAttribute('src')).toBe('data:text/plain,note');
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it('closes from the visible dialog action', async () => {
    viewUrl.mockResolvedValue('data:text/plain,note');
    const onClose = vi.fn();
    render(<FileViewer path="note.md" name="note.md" onClose={onClose} />);

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('shows a useful error when the signed link cannot be created', async () => {
    viewUrl.mockRejectedValue(new Error('offline'));
    render(<FileViewer path="note.md" name="note.md" onClose={() => undefined} />);

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('could not be opened'),
    );
  });
});
