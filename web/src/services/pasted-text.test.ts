import { describe, expect, it } from 'vitest';
import { pastedTextAttachment, shouldAttachPastedText } from './pasted-text';

describe('plain-text paste attachments', () => {
  it('uses strict thresholds and retains ordinary or empty pastes', () => {
    expect(shouldAttachPastedText('x'.repeat(10000), 0)).toBe(false);
    expect(shouldAttachPastedText('x'.repeat(10001), 0)).toBe(true);
    expect(shouldAttachPastedText('x', 31999)).toBe(false);
    expect(shouldAttachPastedText('x', 32000)).toBe(true);
    expect(shouldAttachPastedText('', 40000)).toBe(false);
  });
  it('round trips a large log and Unicode without newline normalization', () => {
    for (const text of ['x'.repeat(43562), 'ação 🎵\r\n\t'.repeat(5000)]) {
      const result = pastedTextAttachment(new TextEncoder().encode(text), 'paste.txt');
      expect(result.type).toBe('text/plain');
      expect(Buffer.from(result.dataUri.split(',')[1]!, 'base64').toString('utf8')).toBe(text);
    }
  });
});
