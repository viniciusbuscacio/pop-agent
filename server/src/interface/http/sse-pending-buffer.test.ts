import { describe, expect, it } from 'vitest';
import { SsePendingBuffer } from './sse-pending-buffer.js';

describe('SSE pending buffer', () => {
  it('bounds queued event count and accepts more after draining', () => {
    const pending = new SsePendingBuffer(2, 1_000);

    expect(pending.push('one')).toBe(true);
    expect(pending.push('two')).toBe(true);
    expect(pending.push('three')).toBe(false);
    expect(pending.shift()).toBe('one');
    expect(pending.push('three')).toBe(true);
    expect(pending.length).toBe(2);
  });

  it('counts UTF-8 bytes rather than JavaScript characters', () => {
    const pending = new SsePendingBuffer(10, 4);

    expect(pending.push('é')).toBe(true);
    expect(pending.push('é')).toBe(true);
    expect(pending.push('a')).toBe(false);
    expect(pending.shift()).toBe('é');
    expect(pending.push('a')).toBe(true);
  });
});
