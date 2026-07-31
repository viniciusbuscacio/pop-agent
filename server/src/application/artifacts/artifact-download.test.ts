import { describe, expect, it } from 'vitest';
import {
  buildSignedLink,
  DEFAULT_LINK_TTL_MS,
  verifyDownload,
} from './artifact-download.js';

const KEY = Buffer.from('a'.repeat(32));
const OTHER_KEY = Buffer.from('b'.repeat(32));
const NOW = 1_800_000_000_000;

function paramsOf(url: string): { expires: string; sig: string } {
  const query = new URL(url, 'http://x').searchParams;
  return { expires: query.get('expires') ?? '', sig: query.get('sig') ?? '' };
}

describe('artifact download links', () => {
  it('signs a link that verifies before it expires', () => {
    const link = buildSignedLink(KEY, 'file-abc', NOW);
    const { expires, sig } = paramsOf(link.url);

    expect(link.expiresAt).toBe(NOW + DEFAULT_LINK_TTL_MS);
    expect(verifyDownload(KEY, 'file-abc', expires, sig, NOW)).toBe('ok');
  });

  it('rejects a tampered signature', () => {
    const { expires } = paramsOf(buildSignedLink(KEY, 'file-abc', NOW).url);
    expect(verifyDownload(KEY, 'file-abc', expires, 'not-the-signature', NOW)).toBe('bad-signature');
  });

  it('rejects a lengthened expiry as a bad signature, not a valid extension', () => {
    const { sig } = paramsOf(buildSignedLink(KEY, 'file-abc', NOW).url);
    const forgedExpiry = String(NOW + DEFAULT_LINK_TTL_MS * 10);
    expect(verifyDownload(KEY, 'file-abc', forgedExpiry, sig, NOW)).toBe('bad-signature');
  });

  it('rejects a link signed for a different id', () => {
    const { expires, sig } = paramsOf(buildSignedLink(KEY, 'file-abc', NOW).url);
    expect(verifyDownload(KEY, 'file-xyz', expires, sig, NOW)).toBe('bad-signature');
  });

  it('rejects a link signed with a different key', () => {
    const { expires, sig } = paramsOf(buildSignedLink(OTHER_KEY, 'file-abc', NOW).url);
    expect(verifyDownload(KEY, 'file-abc', expires, sig, NOW)).toBe('bad-signature');
  });

  it('rejects an expired link even though the file may still exist', () => {
    const link = buildSignedLink(KEY, 'file-abc', NOW, 1000);
    const { expires, sig } = paramsOf(link.url);
    expect(verifyDownload(KEY, 'file-abc', expires, sig, NOW + 2000)).toBe('expired');
  });

  it('treats missing or non-numeric parameters as malformed', () => {
    const { sig } = paramsOf(buildSignedLink(KEY, 'file-abc', NOW).url);
    expect(verifyDownload(KEY, 'file-abc', undefined, sig, NOW)).toBe('malformed');
    expect(verifyDownload(KEY, 'file-abc', 'soon', sig, NOW)).toBe('malformed');
  });
});
