import argon2 from 'argon2';
import type { PasswordHasher } from '../../application/ports/password-hasher.js';

/**
 * argon2id password hashing (docs/specs/Spec-Pop-General.md §9). Parameters are stated explicitly
 * rather than left to the library default, so a future version changing its
 * mind does not silently weaken existing installs.
 *
 * 64 MB / 3 passes / 4 lanes is the OWASP-style middle ground: costly enough
 * to make offline guessing painful, cheap enough that a login on a small VPS
 * stays under a moment. The salt and every parameter are encoded in the hash
 * string, so a later change verifies old hashes fine.
 */
const OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 4,
} as const;

export class Argon2PasswordHasher implements PasswordHasher {
  hash(plaintext: string): Promise<string> {
    return argon2.hash(plaintext, OPTIONS);
  }

  async verify(hash: string, plaintext: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plaintext);
    } catch {
      // A malformed or foreign hash is a failed login, not a crash.
      return false;
    }
  }
}
