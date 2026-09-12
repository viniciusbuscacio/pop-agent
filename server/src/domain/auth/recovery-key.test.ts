import { describe, expect, it } from 'vitest';
import {
  RECOVERY_KEY_ALPHABET,
  RECOVERY_KEY_LENGTH,
  generateRecoveryKey,
  hashRecoveryKey,
  isValidRecoveryKeyFormat,
  normalizeRecoveryKey,
  recoveryKeyMatches,
} from './recovery-key.js';

describe('recovery key', () => {
  it('is six groups of four, hyphenated', () => {
    expect(generateRecoveryKey()).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){5}$/);
  });

  it('never emits a symbol outside the alphabet', () => {
    for (let i = 0; i < 1000; i += 1) {
      for (const symbol of normalizeRecoveryKey(generateRecoveryKey())) {
        expect(RECOVERY_KEY_ALPHABET).toContain(symbol);
      }
    }
  });

  it('excludes the characters people misread', () => {
    for (const confusable of ['0', 'O', '1', 'I', 'L']) {
      expect(RECOVERY_KEY_ALPHABET).not.toContain(confusable);
    }
  });

  it('does not repeat itself', () => {
    const keys = new Set(Array.from({ length: 200 }, () => generateRecoveryKey()));
    expect(keys.size).toBe(200);
  });

  it('accepts the key however the user typed it', () => {
    const key = generateRecoveryKey();
    const hash = hashRecoveryKey(key);

    for (const variant of [
      key,
      key.toLowerCase(),
      key.replace(/-/g, ''),
      key.replace(/-/g, ' '),
      `  ${key.toLowerCase()}  `,
    ]) {
      expect(recoveryKeyMatches(hash, variant), variant).toBe(true);
    }
  });

  it('normalizes to exactly the stored symbols', () => {
    expect(normalizeRecoveryKey('abcd-efgh')).toBe('ABCDEFGH');
    expect(normalizeRecoveryKey('ABCD EFGH')).toBe('ABCDEFGH');
  });

  it('rejects the wrong length and foreign symbols', () => {
    expect(isValidRecoveryKeyFormat('ABCD')).toBe(false);
    expect(isValidRecoveryKeyFormat('A'.repeat(RECOVERY_KEY_LENGTH))).toBe(true);
    expect(isValidRecoveryKeyFormat(`0${'A'.repeat(RECOVERY_KEY_LENGTH - 1)}`)).toBe(false);
  });

  it('rejects a different key', () => {
    expect(recoveryKeyMatches(hashRecoveryKey(generateRecoveryKey()), generateRecoveryKey())).toBe(
      false,
    );
  });

  it('rejects malformed input without throwing', () => {
    expect(recoveryKeyMatches(hashRecoveryKey(generateRecoveryKey()), '')).toBe(false);
    expect(recoveryKeyMatches(hashRecoveryKey(generateRecoveryKey()), 'not-a-key')).toBe(false);
  });

  it('spreads symbols evenly enough to show no modulo bias', () => {
    // 31 does not divide 256, so folding raw bytes with `%` would make the
    // first eight symbols ~3% more likely. Rejection sampling should leave the
    // spread within noise of uniform.
    const counts = new Map<string, number>();
    const draws = 200 * RECOVERY_KEY_LENGTH;
    for (let i = 0; i < 200; i += 1) {
      for (const symbol of normalizeRecoveryKey(generateRecoveryKey())) {
        counts.set(symbol, (counts.get(symbol) ?? 0) + 1);
      }
    }
    const expected = draws / RECOVERY_KEY_ALPHABET.length;
    for (const symbol of RECOVERY_KEY_ALPHABET) {
      expect(counts.get(symbol) ?? 0, `symbol ${symbol}`).toBeGreaterThan(expected * 0.5);
    }
  });
});
