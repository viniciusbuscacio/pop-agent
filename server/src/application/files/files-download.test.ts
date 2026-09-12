import { describe, expect, it } from 'vitest';
import { buildFileLink, DEFAULT_LINK_TTL_MS, verifyFileDownload } from './files-download.js';

const KEY = Buffer.from('a'.repeat(32));
const OTHER_KEY = Buffer.from('b'.repeat(32));
const NOW = 1_800_000_000_000;

function paramsOf(url: string): { path: string; expires: string; sig: string } {
  const query = new URL(url, 'http://x').searchParams;
  return {
    path: query.get('path') ?? '',
    expires: query.get('expires') ?? '',
    sig: query.get('sig') ?? '',
  };
}

describe('files download links', () => {
  it('signs a link that verifies before it expires', () => {
    const link = buildFileLink(KEY, 'reports/pesca.pdf', NOW);
    const { path, expires, sig } = paramsOf(link.url);

    expect(path).toBe('reports/pesca.pdf');
    expect(link.expiresAt).toBe(NOW + DEFAULT_LINK_TTL_MS);
    expect(verifyFileDownload(KEY, path, expires, sig, NOW)).toBe('ok');
  });

  it('url-encodes the path so names with spaces and accents survive the trip', () => {
    const link = buildFileLink(KEY, 'notas/relatório final.pdf', NOW);
    const { path, expires, sig } = paramsOf(link.url);
    expect(path).toBe('notas/relatório final.pdf');
    expect(verifyFileDownload(KEY, path, expires, sig, NOW)).toBe('ok');
  });

  it('rejects a tampered signature', () => {
    const { expires } = paramsOf(buildFileLink(KEY, 'a.txt', NOW).url);
    expect(verifyFileDownload(KEY, 'a.txt', expires, 'not-the-signature', NOW)).toBe(
      'bad-signature',
    );
  });

  it('rejects a lengthened expiry as a bad signature, not a valid extension', () => {
    const { sig } = paramsOf(buildFileLink(KEY, 'a.txt', NOW).url);
    const forgedExpiry = String(NOW + DEFAULT_LINK_TTL_MS * 10);
    expect(verifyFileDownload(KEY, 'a.txt', forgedExpiry, sig, NOW)).toBe('bad-signature');
  });

  it('rejects a link signed for a different path', () => {
    const { expires, sig } = paramsOf(buildFileLink(KEY, 'a.txt', NOW).url);
    expect(verifyFileDownload(KEY, 'secret.key', expires, sig, NOW)).toBe('bad-signature');
  });

  it('rejects a link signed with a different key', () => {
    const { expires, sig } = paramsOf(buildFileLink(OTHER_KEY, 'a.txt', NOW).url);
    expect(verifyFileDownload(KEY, 'a.txt', expires, sig, NOW)).toBe('bad-signature');
  });

  it('rejects an expired link even though the file may still exist', () => {
    const link = buildFileLink(KEY, 'a.txt', NOW, 1000);
    const { expires, sig } = paramsOf(link.url);
    expect(verifyFileDownload(KEY, 'a.txt', expires, sig, NOW + 2000)).toBe('expired');
  });

  it('treats missing or non-numeric parameters as malformed', () => {
    const { sig } = paramsOf(buildFileLink(KEY, 'a.txt', NOW).url);
    expect(verifyFileDownload(KEY, 'a.txt', undefined, sig, NOW)).toBe('malformed');
    expect(verifyFileDownload(KEY, 'a.txt', 'soon', sig, NOW)).toBe('malformed');
  });
});
