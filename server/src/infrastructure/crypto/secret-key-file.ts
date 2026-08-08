import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { SECRET_KEY_BYTES } from '../../application/crypto/secret-box.js';

/**
 * Loads POP_AGENT_DATA_DIR/secret.key, creating it on first boot (pop-agent.spec §9).
 * This file is what makes the secrets table readable, so it is 0600 and stays
 * out of backups: a leaked backup then leaks no credentials.
 */
export function loadOrCreateSecretKey(file: string): Buffer {
  if (existsSync(file)) {
    const key = readFileSync(file);
    if (key.length !== SECRET_KEY_BYTES) {
      throw new Error(
        `${file} must hold exactly ${SECRET_KEY_BYTES} bytes; refusing to run with a malformed key`,
      );
    }
    return key;
  }

  const key = randomBytes(SECRET_KEY_BYTES);
  writeFileSync(file, key, { mode: 0o600 });
  // writeFileSync applies `mode` only when it creates the file; an existing
  // file with looser permissions would keep them, so be explicit.
  chmodSync(file, 0o600);
  return key;
}
