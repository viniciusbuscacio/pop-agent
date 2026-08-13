/** @vitest-environment happy-dom */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { textView, viewUrl } = vi.hoisted(() => ({
  textView: vi.fn<(path: string) => Promise<string>>(),
  viewUrl: vi.fn<(path: string) => Promise<string>>(),
}));
vi.mock('../services/artifacts', () => ({ filesService: { textView, viewUrl } }));

import { FileViewer } from './file-viewer';

afterEach(() => {
  cleanup();
  textView.mockReset();
  viewUrl.mockReset();
});

describe('FileViewer', () => {
  it('paints Markdown with the app font instead of loading a flashing document frame', async () => {
    textView.mockResolvedValue('# A note\n\nReadable text');
    const open = vi.spyOn(window, 'open');

    render(<FileViewer path="note.md" name="note.md" onClose={() => undefined} />);

    const preview = await screen.findByTestId('file-text-preview');
    expect(preview.textContent).toContain('Readable text');
    expect(preview.className).toContain('font-sans');
    expect(preview.className).toContain('text-base');
    expect(screen.queryByTitle('note.md')).toBeNull();
    expect(viewUrl).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it('keeps non-text browser previews inside the PWA', async () => {
    viewUrl.mockResolvedValue('data:application/pdf,pdf');
    render(<FileViewer path="paper.pdf" name="paper.pdf" onClose={() => undefined} />);

    const frame = await screen.findByTitle('paper.pdf');
    expect(frame.getAttribute('src')).toBe('data:application/pdf,pdf');
  });

  it('closes from the visible dialog action', async () => {
    textView.mockResolvedValue('note');
    const onClose = vi.fn();
    render(<FileViewer path="note.md" name="note.md" onClose={onClose} />);

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('shows a useful error when the preview cannot be loaded', async () => {
    textView.mockRejectedValue(new Error('offline'));
    render(<FileViewer path="note.md" name="note.md" onClose={() => undefined} />);

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('could not be opened'),
    );
  });
});
