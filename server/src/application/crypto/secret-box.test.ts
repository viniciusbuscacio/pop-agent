import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SECRET_KEY_BYTES, open, seal } from './secret-box.js';

const key = randomBytes(SECRET_KEY_BYTES);

describe('secret box', () => {
  it('opens what it sealed', () => {
    const plaintext = 'sk-or-v1-not-a-real-key';
    expect(open(key, seal(key, plaintext))).toBe(plaintext);
  });

  it('handles unicode and empty values', () => {
    for (const plaintext of ['', 'ação — ✅', 'a'.repeat(10_000)]) {
      expect(open(key, seal(key, plaintext))).toBe(plaintext);
    }
  });

  it('never emits the same ciphertext twice for the same input', () => {
    const first = seal(key, 'same input');
    const second = seal(key, 'same input');
    expect(first.equals(second)).toBe(false);
  });

  it('refuses a value edited in place', () => {
    const sealed = seal(key, 'tamper with me');
    const last = sealed.length - 1;
    sealed.writeUInt8(sealed.readUInt8(last) ^ 0xff, last); // flip bits in the auth tag
    expect(() => open(key, sealed)).toThrow();
  });

  it('refuses the wrong key', () => {
    const sealed = seal(key, 'for my eyes only');
    expect(() => open(randomBytes(SECRET_KEY_BYTES), sealed)).toThrow();
  });

  it('refuses a key of the wrong length', () => {
    expect(() => seal(randomBytes(16), 'x')).toThrow(/must be 32 bytes/);
  });

  it('refuses a buffer too short to hold a nonce and tag', () => {
    expect(() => open(key, Buffer.alloc(4))).toThrow(/cannot be genuine/);
  });
});
