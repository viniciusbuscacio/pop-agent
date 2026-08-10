// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Markdown, internalFilePath } from './markdown';

const link = vi.fn();
const saveFromLink = vi.fn();

vi.mock('../services/artifacts', () => ({
  filesService: {
    link: (path: string) => link(path) as Promise<string>,
  },
}));

vi.mock('../lib/download', () => ({
  saveFromLink: (url: string) => saveFromLink(url),
}));

beforeEach(() => {
  link.mockReset();
  saveFromLink.mockReset();
});

afterEach(cleanup);

function markDecoded(image: HTMLImageElement): void {
  Object.defineProperties(image, {
    naturalWidth: { configurable: true, value: 320 },
    naturalHeight: { configurable: true, value: 180 },
  });
}

describe('generated images in markdown', () => {
  it('resolves an attachment reference into a fresh inline Files link', async () => {
    link.mockResolvedValue('/files/download?path=previews%2Fchart.png&expires=2&sig=fresh');
    render(<Markdown text="![Sales chart](attachment://previews/chart.png)" />);

    expect(screen.getByTestId('markdown-image-loading').textContent).toContain('Sales chart');
    const image = await screen.findByTestId('markdown-image');
    expect(link).toHaveBeenCalledWith('previews/chart.png');
    expect(image.getAttribute('src')).toBe(
      '/files/download?path=previews%2Fchart.png&expires=2&sig=fresh&inline=1',
    );

    markDecoded(image as HTMLImageElement);
    fireEvent.load(image);
    expect(screen.queryByTestId('markdown-image-fallback')).toBeNull();
  });

  it('offers the signed download when the browser cannot render the preview', async () => {
    link.mockResolvedValue('/files/download?path=broken.png&expires=2&sig=fresh');
    render(<Markdown text="![Broken preview](attachment://broken.png)" />);

    const image = await screen.findByTestId('markdown-image');
    fireEvent.error(image);

    const fallback = await screen.findByTestId('markdown-image-fallback');
    expect(fallback.textContent).toContain('Could not show the preview');
    await userEvent.click(screen.getByRole('button', { name: 'Download image' }));
    expect(saveFromLink).toHaveBeenCalledWith(
      '/files/download?path=broken.png&expires=2&sig=fresh',
    );
  });

  it('renews a persisted signed link instead of trusting its expiry', async () => {
    link.mockResolvedValue('/files/download?path=old.png&expires=9&sig=new');
    render(
      <Markdown text="![Old](/files/download?path=old.png&expires=1&sig=expired&inline=1)" />,
    );

    await screen.findByTestId('markdown-image');
    expect(link).toHaveBeenCalledWith('old.png');
  });

  it('falls back to Files when the file no longer exists', async () => {
    link.mockRejectedValue(new Error('not found'));
    render(<Markdown text="![Gone](attachment://gone.png)" />);

    const fallback = await screen.findByTestId('markdown-image-fallback');
    expect(fallback.querySelector('a')?.getAttribute('href')).toBe('/files');
  });
});

describe('internal image paths', () => {
  it('accepts stable Files references and rejects traversal', () => {
    expect(internalFilePath('attachment://folder/my%20image.png')).toBe('folder/my image.png');
    expect(internalFilePath('Files/chart.png')).toBe('chart.png');
    expect(internalFilePath('attachment://../secret.png')).toBeUndefined();
    expect(internalFilePath('attachment://folder\\secret.png')).toBeUndefined();
  });

  it('leaves external images outside the Files resolver', async () => {
    render(<Markdown text="![Remote](https://example.com/image.png)" />);
    await waitFor(() => expect(screen.getByTestId('markdown-image')).toBeDefined());
    expect(link).not.toHaveBeenCalled();
  });
});
