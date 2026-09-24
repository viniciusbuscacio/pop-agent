// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Markdown, internalFilePath } from './markdown';

const link = vi.fn();
const blob = vi.fn();
const saveFromLink = vi.fn();
const highlightCode = vi.hoisted(() => vi.fn());

vi.mock('../lib/syntax-highlighter', () => ({ highlightCode }));

vi.mock('../services/artifacts', () => ({
  filesService: {
    blob: (url: string) => blob(url),
    link: (path: string) => link(path) as Promise<string>,
  },
}));

vi.mock('../lib/download', () => ({
  saveFromLink: (url: string) => saveFromLink(url),
}));

beforeEach(() => {
  link.mockReset();
  blob.mockReset();
  blob.mockResolvedValue({ blob: new Blob(['image'], { type: 'image/png' }), filename: 'chart.png' });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:authenticated-preview');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  saveFromLink.mockReset();
  highlightCode.mockReset();
  highlightCode.mockResolvedValue('<pre class="shiki"><code>highlighted</code></pre>');
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function markDecoded(image: HTMLImageElement): void {
  Object.defineProperties(image, {
    naturalWidth: { configurable: true, value: 320 },
    naturalHeight: { configurable: true, value: 180 },
  });
}

describe('horizontal overflow containment', () => {
  it('wraps ordinary tokens but keeps code and tables in local scroll areas', () => {
    const { container } = render(
      <Markdown text={`A${'x'.repeat(2_000)}\n\n\`\`\`text\n${'y'.repeat(2_000)}\n\`\`\`\n\n| ${'z'.repeat(200)} |\n| --- |\n| value |`} />,
    );

    const root = container.querySelector('.markdown');
    const code = container.querySelector('pre');
    const table = container.querySelector('table');
    expect(root?.className).toContain('min-w-0');
    expect(root?.className).toContain('[overflow-wrap:anywhere]');
    expect(code?.parentElement?.className).toContain('max-w-full');
    expect(code?.parentElement?.className).toContain('overflow-x-auto');
    expect(table?.parentElement?.className).toContain('max-w-full');
    expect(table?.parentElement?.className).toContain('overflow-x-auto');
  });
});

describe('code block rendering', () => {
  it('keeps plain text on the stable renderer instead of loading Shiki later', async () => {
    const { container } = render(<Markdown text={'```text\ncommit-id\n```'} />);

    expect(container.querySelector('pre')?.textContent).toBe('commit-id');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(highlightCode).not.toHaveBeenCalled();
    expect(container.querySelector('.code-shiki')).toBeNull();
  });

  it('still highlights languages with syntax', async () => {
    const { container } = render(<Markdown text={'```typescript\nconst value = 1\n```'} />);

    await waitFor(() => expect(highlightCode).toHaveBeenCalledWith('const value = 1', 'typescript'));
    expect(container.querySelector('.code-shiki')).not.toBeNull();
  });

  it('preserves real Shiki palettes and escaped source, with unknown-language fallback', async () => {
    const actual = await vi.importActual<typeof import('../lib/syntax-highlighter')>('../lib/syntax-highlighter');
    highlightCode.mockImplementation(actual.highlightCode);
    const source = 'const value = "<script>alert(1)</script>"';
    const { container, rerender } = render(<Markdown text={fence(source)} />);
    await waitFor(() => expect(container.querySelector('.shiki')).not.toBeNull());
    expect(container.querySelector('pre')?.textContent).toBe(source);
    expect(container.querySelector('script')).toBeNull();
    expect(container.innerHTML).toContain('--shiki-light');
    expect(container.innerHTML).toContain('--shiki-dark');

    rerender(<Markdown text={fence(source, 'not-a-supported-language')} />);
    await waitFor(() => expect(highlightCode).toHaveBeenCalledTimes(2));
    await act(async () => { await Promise.resolve(); });
    expect(container.querySelector('.shiki')).toBeNull();
    expect(container.querySelector('pre')?.textContent).toBe(source);
    expect(container.querySelector('script')).toBeNull();
  });
});

function deferredHighlight() {
  let resolve!: (html: string) => void;
  const promise = new Promise<string>((done) => { resolve = done; });
  return { promise, resolve };
}

const fence = (code: string, language = 'typescript') => `\`\`\`${language}\n${code}\n\`\`\``;
const highlighted = (code: string) => `<pre class="shiki"><code><span>${code}</span></code></pre>`;

// Include list ancestors: a stable pre renderer alone does not prevent remounts.
describe('streaming code stability', () => {
  it.each(['top-level', 'nested lists'])('keeps %s code, controls and scroll state stable through deltas', async (placement) => {
    const text = (code: string, closed = true) => {
      const block = closed ? fence(code) : fence(code).slice(0, -4);
      return placement === 'top-level'
        ? block : `1. outer\n   - inner\n\n${block.split('\n').map((line) => `     ${line}`).join('\n')}`;
    };
    const pending = deferredHighlight();
    highlightCode.mockReturnValue(pending.promise);
    const { container, rerender } = render(<Markdown text={text('const a', false)} streaming />);
    const pre = container.querySelector('pre')!;
    const scroller = pre.parentElement!;
    const copy = screen.getByTestId('code-copy');
    scroller.scrollLeft = 42;
    copy.focus();

    for (const code of ['const a =', 'const a = 1', 'const a = 123']) {
      rerender(<Markdown text={text(code, code === 'const a = 123')} streaming />);
      expect(container.querySelector('pre')).toBe(pre);
      expect(pre.textContent).toBe(code);
      expect(screen.getByTestId('code-copy')).toBe(copy);
      expect(document.activeElement).toBe(copy);
      expect(scroller.scrollLeft).toBe(42);
      await act(async () => { await Promise.resolve(); });
      expect(highlightCode).not.toHaveBeenCalled();
    }

    rerender(<Markdown text={text('const a = 123')} />);
    await waitFor(() => expect(highlightCode).toHaveBeenCalledExactlyOnceWith('const a = 123', 'typescript'));
    expect(pre.textContent).toBe('const a = 123');
    await act(async () => { pending.resolve(highlighted('const a = 123')); });
    expect(container.querySelector('.code-shiki')).toBe(scroller);
    expect(scroller.scrollLeft).toBe(42);
    expect(document.activeElement).toBe(copy);
    const tokens = scroller.querySelector('span');
    rerender(<Markdown text={`${text('const a = 123')}\n\nMore prose`} />);
    expect(scroller.querySelector('span')).toBe(tokens);
    expect(highlightCode).toHaveBeenCalledTimes(1);
  });

  it('shows new source immediately and rejects out-of-order code/language results', async () => {
    const first = deferredHighlight();
    const second = deferredHighlight();
    const third = deferredHighlight();
    highlightCode.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise);
    const { container, rerender } = render(<Markdown text={fence('old')} />);
    await waitFor(() => expect(highlightCode).toHaveBeenCalledTimes(1));
    await act(async () => { first.resolve(highlighted('old')); });
    expect(container.querySelector('pre')?.textContent).toBe('old');

    rerender(<Markdown text={fence('current')} />);
    expect(container.querySelector('pre')?.textContent).toBe('current');
    expect(container.querySelector('.code-shiki')).toBeNull();
    await waitFor(() => expect(highlightCode).toHaveBeenCalledTimes(2));
    rerender(<Markdown text={fence('current', 'javascript')} />);
    await waitFor(() => expect(highlightCode).toHaveBeenCalledTimes(3));
    await act(async () => { third.resolve(highlighted('current')); });
    const tokens = container.querySelector('.shiki span');
    await act(async () => { second.resolve(highlighted('WRONG late language')); });
    expect(container.querySelector('.shiki span')).toBe(tokens);
    expect(container.querySelector('pre')?.textContent).toBe('current');
  });

  it('discards a pending result when streaming resumes and copies the current source', async () => {
    const pending = deferredHighlight();
    highlightCode.mockReturnValueOnce(pending.promise);
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(writeText);
    const { container, rerender } = render(<Markdown text={fence('before')} />);
    await waitFor(() => expect(highlightCode).toHaveBeenCalledTimes(1));
    rerender(<Markdown text={fence('before and after')} streaming />);
    await act(async () => { pending.resolve(highlighted('before')); });
    expect(container.querySelector('pre')?.textContent).toBe('before and after');
    expect(container.querySelector('.code-shiki')).toBeNull();
    fireEvent.click(screen.getByTestId('code-copy'));
    await waitFor(() => expect(writeText).toHaveBeenCalledExactlyOnceWith('before and after'));
    expect(highlightCode).toHaveBeenCalledTimes(1);
  });

  it.each(['', 'text', 'txt', 'plaintext', 'unknown-language'])('falls back to current plain source for "%s" after highlighted code', async (language) => {
    const { container, rerender } = render(<Markdown text={fence('old')} />);
    await waitFor(() => expect(container.querySelector('.code-shiki')).not.toBeNull());
    highlightCode.mockRejectedValue(new Error('Unsupported language or chunk failure'));
    rerender(<Markdown text={fence('<new & safe>', language)} />);
    expect(container.querySelector('pre')?.textContent).toBe('<new & safe>');
    await act(async () => { await Promise.resolve(); });
    expect(container.querySelector('pre')?.textContent).toBe('<new & safe>');
    expect(container.querySelector('.code-shiki')).toBeNull();
    expect(highlightCode).toHaveBeenCalledTimes(language === 'unknown-language' ? 2 : 1);
  });
});

describe('generated images in markdown', () => {
  it('resolves an attachment reference into a fresh inline Files link', async () => {
    link.mockResolvedValue('/files/download?path=previews%2Fchart.png&expires=2&sig=fresh');
    render(<Markdown text="![Sales chart](attachment://previews/chart.png)" />);

    expect(screen.getByTestId('markdown-image-loading').textContent).toContain('Sales chart');
    const image = await screen.findByTestId('markdown-image');
    expect(link).toHaveBeenCalledWith('previews/chart.png');
    expect(image.getAttribute('src')).toBe(
      'blob:authenticated-preview',
    );

    expect(blob).toHaveBeenCalledWith('/files/download?path=previews%2Fchart.png&expires=2&sig=fresh&inline=1');
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


it('downloads a persisted file link through the authenticated service', async () => {
  link.mockResolvedValue('/files/download?path=report.pdf&expires=9&sig=new');
  render(<Markdown text="[Download report](/files/download?path=report.pdf&expires=1&sig=old)" />);
  await userEvent.click(screen.getByRole('button', { name: 'Download report' }));
  await waitFor(() => expect(saveFromLink).toHaveBeenCalledWith('/files/download?path=report.pdf&expires=9&sig=new'));
  expect(link).toHaveBeenCalledWith('report.pdf');
});
it('revokes an image object URL when its chat message leaves the screen', async () => {
  link.mockResolvedValue('/files/download?path=chart.png&expires=9&sig=new');
  const rendered = render(<Markdown text="![Chart](files://chart.png)" />);
  await screen.findByTestId('markdown-image');
  rendered.unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:authenticated-preview');
});
