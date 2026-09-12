import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  discardResponseBody,
  extractText,
  isPrivateAddress,
  webFetch,
  WebFetchError,
} from './web-fetch.js';

/**
 * SSRF is the point (docs/specs/Spec-Pop-General.md §12): the DNS resolver is injected, so a host
 * that resolves to a private address is refused before any connection, with no
 * real network touched.
 */

describe('isPrivateAddress', () => {
  const privates = [
    '127.0.0.1',
    '10.1.2.3',
    '192.168.0.1',
    '172.16.5.5',
    '169.254.169.254', // cloud metadata
    '100.64.0.1', // CGNAT
    '0.0.0.0',
    '::1',
    'fe80::1',
    'fe90::1',
    'fd00::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '2001:db8::1',
    'ff02::1',
  ];
  const publics = ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111'];

  it('flags private, loopback and link-local', () => {
    for (const address of privates) expect(isPrivateAddress(address), address).toBe(true);
  });

  it('lets public addresses through', () => {
    for (const address of publics) expect(isPrivateAddress(address), address).toBe(false);
  });
});

describe('webFetch guards', () => {
  it('refuses a non-http scheme', async () => {
    await expect(webFetch('file:///etc/passwd')).rejects.toThrow(WebFetchError);
  });

  it('refuses a host that resolves to a private address, before connecting', async () => {
    const resolve = vi.fn().mockResolvedValue(['10.0.0.5']);
    await expect(webFetch('http://sneaky.example', { resolve })).rejects.toThrow(
      /private address/,
    );
    expect(resolve).toHaveBeenCalledWith('sneaky.example');
  });

  it('refuses an IP literal in a private range', async () => {
    await expect(webFetch('http://169.254.169.254/latest/meta-data')).rejects.toThrow(
      /private address/,
    );
  });

  it('refuses a host that does not resolve', async () => {
    const resolve = vi.fn().mockResolvedValue([]);
    await expect(webFetch('http://nowhere.example', { resolve })).rejects.toThrow(/resolved/);
  });

  it('passes the screened addresses to the connection layer without resolving again', async () => {
    const resolve = vi.fn().mockResolvedValue(['93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946']);
    const retrieve = vi.fn().mockResolvedValue('<title>Safe</title><p>Body</p>');
    const result = await webFetch('https://example.com/page', { resolve, retrieve });
    expect(retrieve).toHaveBeenCalledWith(
      new URL('https://example.com/page'),
      ['93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946'],
    );
    expect(resolve).toHaveBeenCalledOnce();
    expect(result).toEqual({ url: 'https://example.com/page', title: 'Safe', text: 'Safe Body' });
  });

  it('refuses credentials embedded in URLs', async () => {
    await expect(webFetch('https://owner:secret@example.com')).rejects.toThrow(/credentials/);
  });
});

describe('response cancellation', () => {
  it('absorbs Undici\'s expected abort error when an unread body is discarded', () => {
    const body = new EventEmitter() as EventEmitter & { destroy(): void };
    let destroyed = false;
    body.destroy = () => {
      destroyed = true;
    };

    discardResponseBody(body);

    expect(destroyed).toBe(true);
    // EventEmitter throws an unhandled `error`; the cancellation listener is
    // therefore the behavior that keeps RequestAbortedError inside the tool.
    expect(() => body.emit('error', new Error('Request aborted'))).not.toThrow();
  });
});

describe('extractText', () => {
  it('pulls readable text out of html and drops scripts', () => {
    const html =
      '<html><head><title>Hi</title><style>x{}</style></head>' +
      '<body><h1>Title</h1><script>evil()</script><p>Hello world.</p></body></html>';
    const text = extractText(html);
    expect(text).toContain('Title');
    expect(text).toContain('Hello world.');
    expect(text).not.toContain('evil');
    expect(text).not.toContain('x{}');
  });

  it('decodes the common entities', () => {
    expect(extractText('<p>a &amp; b &lt; c</p>')).toBe('a & b < c');
  });
});
