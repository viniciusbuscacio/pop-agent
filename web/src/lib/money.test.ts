import { describe, expect, it } from 'vitest';
import { formatDollars } from './money';

describe('formatDollars', () => {
  it('puts the minus before the dollar sign', () => {
    expect(formatDollars(-0.1)).toBe('-$0.10');
  });

  it('formats zero and positive amounts', () => {
    expect(formatDollars(0)).toBe('$0.00');
    expect(formatDollars(12.5)).toBe('$12.50');
  });
});
