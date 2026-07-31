import { randomBytes } from 'node:crypto';

/**
 * Identifiers and internal file names (popy.spec §6). Two shapes, one
 * generator:
 *
 * - **Entity id**: `prefix-<11 base62>` with a full-word prefix -- `chat-`,
 *   `message-`, `run-`, `file-`. The hyphen marks it as an id.
 * - **Internal file name**: `prefix_<11 base62>.ext`, e.g. `audio_2f9FmGo58Jm.wav`.
 *   The underscore marks it as a file Popy made, not a user's.
 *
 * Eleven base62 characters is ~65 bits from a CSPRNG -- more entropy than the
 * old hex ids, and drawn without modulo bias by rejection sampling, so nothing
 * about the install leaks through an id and two are never predictably close.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const ID_LENGTH = 11;

export function newChatId(): string {
  return entityId('chat');
}

export function newMessageId(): string {
  return entityId('message');
}

export function newRunId(): string {
  return entityId('run');
}

/** A `prefix-<11 base62>` entity id. */
export function entityId(prefix: string): string {
  return `${prefix}-${randomBase62(ID_LENGTH)}`;
}

/** A `prefix_<11 base62>.ext` name for a file Popy creates internally. */
export function randomFileName(prefix: string, extension: string): string {
  const ext = extension.startsWith('.') ? extension : `.${extension}`;
  return `${prefix}_${randomBase62(ID_LENGTH)}${ext}`;
}

/**
 * `length` base62 characters with no modulo bias: a byte is 0-255, and only the
 * first 248 (4 x 62) values are used -- the rest are redrawn -- so every
 * character is uniform.
 */
export function randomBase62(length: number): string {
  let out = '';
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte >= 248) continue; // reject the biased tail
      out += ALPHABET[byte % 62];
      if (out.length === length) break;
    }
  }
  return out;
}
