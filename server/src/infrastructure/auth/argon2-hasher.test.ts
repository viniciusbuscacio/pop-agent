import { describe, expect, it } from 'vitest';
import { Argon2PasswordHasher } from './argon2-hasher.js';

// The real algorithm, deliberately slow: a handful of cases only, and the
// service tests use a cheap fake instead.
const hasher = new Argon2PasswordHasher();

describe('argon2id password hasher', () => {
  it('verifies the password it hashed', async () => {
    const hash = await hasher.hash('correct horse battery');

    expect(await hasher.verify(hash, 'correct horse battery')).toBe(true);
  });

  it('rejects a different password', async () => {
    const hash = await hasher.hash('correct horse battery');

    expect(await hasher.verify(hash, 'correct horse battistery')).toBe(false);
  });

  it('salts: the same password hashes differently every time', async () => {
    const [first, second] = await Promise.all([hasher.hash('same input'), hasher.hash('same input')]);

    expect(first).not.toBe(second);
  });

  it('records argon2id and the stated cost parameters in the hash', async () => {
    expect(await hasher.hash('parameters please')).toMatch(/^\$argon2id\$v=19\$m=65536,p=4,t=3\$/);
  });

  it('treats a malformed stored hash as a failed login', async () => {
    expect(await hasher.verify('not-a-hash', 'anything')).toBe(false);
  });
}, 30_000);
