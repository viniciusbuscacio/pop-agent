/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { readText, saveText, viewUrl, link, blob } = vi.hoisted(() => ({
  readText: vi.fn<(path: string) => Promise<{ content: string; revision: string }>>(),
  saveText: vi.fn(), link: vi.fn(), blob: vi.fn(),
  viewUrl: vi.fn<(path: string) => Promise<string>>(),
}));
vi.mock('../services/artifacts', () => ({ filesService: { readText, saveText, viewUrl, link, blob } }));

import { FileViewer } from './file-viewer';

afterEach(() => {
  cleanup();
  readText.mockReset(); link.mockReset(); blob.mockReset();
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

it('renders HTML only in an opaque sandbox and offers its escaped source', async () => {
  const html='<h1>Report</h1><script>parent.stolen=true</script>';
  link.mockResolvedValue('/signed');blob.mockResolvedValue({blob:new Blob([html])});
  render(<FileViewer path="report.HTML" name="report.HTML" onClose={vi.fn()} />);
  const frame=await screen.findByTestId('file-html-preview');
  expect(frame.getAttribute('sandbox')).toBe('');
  expect(frame.getAttribute('srcdoc')).toContain("default-src 'none'");
  expect(frame.getAttribute('srcdoc')).toContain(html);
  await userEvent.click(screen.getByRole('button',{name:'Source'}));
  expect(screen.getByTestId('file-text-preview').textContent).toBe(html);
  expect(screen.queryByTestId('file-html-preview')).toBeNull();
  await userEvent.click(screen.getByRole('button',{name:'Preview'}));
  expect(screen.getByTestId('file-html-preview')).toBeTruthy();
});
it.each(['photo.PNG','photo.jpg','photo.webp'])('renders %s as a fitted image and reports load failure', async name => {
  viewUrl.mockResolvedValue('/signed-image');render(<FileViewer path={name} name={name} onClose={vi.fn()} />);
  const img=await screen.findByRole('img',{name});expect(img.getAttribute('src')).toBe('/signed-image');
  fireEvent.error(img);expect(screen.getByRole('alert')).toBeTruthy();
});
it('renders SVG in image context and releases its object URL on close', async () => {
  const create=vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:svg');const revoke=vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
  link.mockResolvedValue('/signed');blob.mockResolvedValue({blob:new Blob(['<svg/>'])});
  const view=render(<FileViewer path="diagram.svg" name="diagram.svg" onClose={vi.fn()} />);
  expect((await screen.findByRole('img')).getAttribute('src')).toBe('blob:svg');
  expect(create.mock.calls[0]?.[0]).toHaveProperty('type','image/svg+xml');
  view.unmount();expect(revoke).toHaveBeenCalledWith('blob:svg');
});
it('revokes SVG URLs even when loading finishes after close', async () => {
  vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:late');const revoke=vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
  let finish!: (value: {blob:Blob})=>void;link.mockResolvedValue('/signed');blob.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  const view=render(<FileViewer path="diagram.svg" name="diagram.svg" onClose={vi.fn()} />);
  await waitFor(()=>expect(blob).toHaveBeenCalled());view.unmount();finish({blob:new Blob(['<svg/>'])});
  await waitFor(()=>expect(revoke).toHaveBeenCalledWith('blob:late'));
});
