import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Authenticated encryption for values stored in the secrets table
 * (docs/specs/Spec-Pop-General.md §9). AES-256-GCM over node:crypto -- no third-party dependency,
 * so this stays in a pure layer.
 *
 * A sealed value is a single buffer: nonce || ciphertext || tag. The nonce is
 * fresh per call (GCM requires it never repeats under one key), and the tag
 * makes tampering fail loudly on open() instead of returning garbage.
 */

const ALGORITHM = 'aes-256-gcm';
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

/** Length of the key file in POP_AGENT_DATA_DIR. */
export const SECRET_KEY_BYTES = 32;

export function seal(key: Buffer, plaintext: string): Buffer {
  assertKeyLength(key);
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, ciphertext, cipher.getAuthTag()]);
}

export function open(key: Buffer, sealed: Buffer): string {
  assertKeyLength(key);
  if (sealed.length < NONCE_BYTES + TAG_BYTES) {
    throw new Error('sealed value is shorter than a nonce and tag: it cannot be genuine');
  }
  const nonce = sealed.subarray(0, NONCE_BYTES);
  const ciphertext = sealed.subarray(NONCE_BYTES, sealed.length - TAG_BYTES);
  const tag = sealed.subarray(sealed.length - TAG_BYTES);

  const decipher = createDecipheriv(ALGORITHM, key, nonce);
  decipher.setAuthTag(tag);
  // final() is what verifies the tag: a wrong key or edited bytes throw here.
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

function assertKeyLength(key: Buffer): void {
  if (key.length !== SECRET_KEY_BYTES) {
    throw new Error(`secret key must be ${SECRET_KEY_BYTES} bytes, got ${key.length}`);
  }
}
