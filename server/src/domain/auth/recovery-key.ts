import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Recovery key: the one credential that survives a forgotten password
 * (popy.spec §9). It is shown exactly once, so it has to be readable off a
 * screen and typeable on a phone keyboard.
 *
 * Alphabet excludes the pairs people misread -- 0/O and 1/I/L -- leaving 31
 * symbols. 24 of them carry ~118 bits, which is far past guessing range, so
 * the format can afford to be friendly.
 */

export const RECOVERY_KEY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const RECOVERY_KEY_LENGTH = 24;
const GROUP_SIZE = 4;

// Rejection sampling: 248 is the largest multiple of 31 below 256, so bytes
// above it are discarded instead of folded back with `%`, which would make the
// first few symbols marginally more likely than the rest.
const REJECTION_CEILING = 248;

/** A fresh key, hyphenated for reading: XXXX-XXXX-XXXX-XXXX-XXXX-XXXX. */
export function generateRecoveryKey(): string {
  const symbols: string[] = [];
  while (symbols.length < RECOVERY_KEY_LENGTH) {
    for (const byte of randomBytes(RECOVERY_KEY_LENGTH)) {
      if (byte >= REJECTION_CEILING) continue;
      symbols.push(RECOVERY_KEY_ALPHABET[byte % RECOVERY_KEY_ALPHABET.length] as string);
      if (symbols.length === RECOVERY_KEY_LENGTH) break;
    }
  }
  return groupsOf(symbols.join(''), GROUP_SIZE).join('-');
}

/**
 * Strips whatever the user typed down to comparable symbols: case is ignored
 * and hyphens or spaces are dropped, so a key read aloud and retyped still
 * matches.
 */
export function normalizeRecoveryKey(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isValidRecoveryKeyFormat(input: string): boolean {
  const normalized = normalizeRecoveryKey(input);
  if (normalized.length !== RECOVERY_KEY_LENGTH) return false;
  return [...normalized].every((symbol) => RECOVERY_KEY_ALPHABET.includes(symbol));
}

/**
 * What gets persisted. SHA-256 rather than argon2 on purpose: the key is
 * CSPRNG-generated with ~118 bits, so there is no low-entropy guess space for
 * a slow hash to protect -- unlike a human-chosen password.
 */
export function hashRecoveryKey(key: string): string {
  return createHash('sha256').update(normalizeRecoveryKey(key), 'utf8').digest('hex');
}

/** Constant-time comparison of a typed key against a stored hash. */
export function recoveryKeyMatches(storedHash: string, input: string): boolean {
  if (!isValidRecoveryKeyFormat(input)) return false;
  const candidate = Buffer.from(hashRecoveryKey(input), 'utf8');
  const stored = Buffer.from(storedHash, 'utf8');
  if (candidate.length !== stored.length) return false;
  return timingSafeEqual(candidate, stored);
}

function groupsOf(value: string, size: number): string[] {
  const groups: string[] = [];
  for (let i = 0; i < value.length; i += size) groups.push(value.slice(i, i + size));
  return groups;
}
