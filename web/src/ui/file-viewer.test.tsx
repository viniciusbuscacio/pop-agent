/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { readText, saveText, viewUrl } = vi.hoisted(() => ({
  readText: vi.fn<(path: string) => Promise<{ content: string; revision: string }>>(),
  saveText: vi.fn(),
  viewUrl: vi.fn<(path: string) => Promise<string>>(),
}));
vi.mock('../services/artifacts', () => ({ filesService: { readText, saveText, viewUrl } }));

import { FileViewer } from './file-viewer';

afterEach(() => {
  cleanup();
  readText.mockReset();
  saveText.mockReset();
  vi.restoreAllMocks();
  viewUrl.mockReset();
});

describe('FileViewer', () => {
  it('paints Markdown with the app font instead of loading a flashing document frame', async () => {
    readText.mockResolvedValue({ content: '# A note\n\nReadable text', revision: 'original' });
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
    readText.mockResolvedValue({ content: 'note', revision: 'original' });
    const onClose = vi.fn();
    render(<FileViewer path="note.md" name="note.md" onClose={onClose} />);

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('shows a useful error when the preview cannot be loaded', async () => {
    readText.mockRejectedValue(new Error('offline'));
    render(<FileViewer path="note.md" name="note.md" onClose={() => undefined} />);

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('could not be opened'),
    );
  });
});

it('saves edited text with its original revision and updates the preview', async () => {
  readText.mockResolvedValue({ content: 'original', revision: 'r1' });
  saveText.mockResolvedValue({ content: '', revision: 'r2' });
  const onSaved=vi.fn();render(<FileViewer path="note.json" name="note.json" onClose={vi.fn()} onSaved={onSaved} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
  fireEvent.change(screen.getByTestId('file-editor'), { target: { value: '' } });
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(saveText).toHaveBeenCalledWith({ path:'note.json',content:'',revision:'r1' });
  expect(screen.getByTestId('file-text-preview').textContent).toBe('');
});
it('keeps failed edits and allows canceling without saving', async () => {
  readText.mockResolvedValue({ content: 'original', revision: 'r1' });
  saveText.mockRejectedValue(new Error('offline'));
  vi.spyOn(window,'confirm').mockReturnValue(false);
  const onClose=vi.fn();render(<FileViewer path="note.md" name="note.md" onClose={onClose} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
  fireEvent.change(screen.getByTestId('file-editor'), { target: { value: 'draft' } });
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent',expect.stringContaining('edits were kept'));
  expect(screen.getByTestId('file-editor')).toHaveProperty('value','draft');
  await userEvent.click(screen.getByRole('button',{name:'Close'}));expect(onClose).not.toHaveBeenCalled();
  vi.mocked(window.confirm).mockReturnValue(true);
  await userEvent.click(screen.getByRole('button',{name:'Cancel'}));
  expect(screen.getByTestId('file-text-preview').textContent).toBe('original');
  expect(saveText).toHaveBeenCalledOnce();
});
