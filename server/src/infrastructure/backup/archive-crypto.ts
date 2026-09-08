import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { open, rm } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { BackupError, validateBackupPassword } from '../../application/backup/backup-password.js';

// v1: magic/version (8), salt (16), nonce (12), ciphertext, GCM tag (16).
// The fixed header is authenticated; KDF cost cannot be controlled by an archive.
const MAGIC = Buffer.from('POPBAK01');
const HEADER_BYTES = 36;
const TAG_BYTES = 16;

function derive(password: string, salt: Buffer): Promise<Buffer> {
  validateBackupPassword(password);
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error !== null) reject(error);
      else resolve(key);
    });
  });
}

export async function encryptArchive(source: () => Readable, destination: string, password: string): Promise<void> {
  const header = Buffer.concat([MAGIC, randomBytes(16), randomBytes(12)]);
  const key = await derive(password, header.subarray(8, 24));
  try {
    const cipher = createCipheriv('aes-256-gcm', key, header.subarray(24), { authTagLength: TAG_BYTES });
    cipher.setAAD(header);
    const handle = await open(destination, 'wx', 0o600);
    try { await handle.writeFile(header); } finally { await handle.close(); }
    await pipeline(source(), cipher, createWriteStream(destination, { flags: 'a', mode: 0o600 }));
    const completed = await open(destination, 'a');
    try {
      await completed.writeFile(cipher.getAuthTag());
      await completed.sync();
    } finally { await completed.close(); }
  } finally { key.fill(0); }
}

/** The private output is never extracted until the entire GCM tag verifies. */
export async function decryptArchive(source: string, destination: string, password: string): Promise<void> {
  const handle = await open(source, 'r');
  let key: Buffer | undefined;
  try {
    const size = (await handle.stat()).size;
    if (size <= HEADER_BYTES + TAG_BYTES) throw new Error('truncated');
    const header = Buffer.alloc(HEADER_BYTES);
    await handle.read(header, 0, HEADER_BYTES, 0);
    if (!header.subarray(0, 8).equals(MAGIC)) throw new Error('unsupported format');
    const tag = Buffer.alloc(TAG_BYTES);
    await handle.read(tag, 0, TAG_BYTES, size - TAG_BYTES);
    key = await derive(password, header.subarray(8, 24));
    const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(24), { authTagLength: TAG_BYTES });
    decipher.setAAD(header);
    decipher.setAuthTag(tag);
    await pipeline(
      createReadStream(source, { fd: handle.fd, autoClose: false, start: HEADER_BYTES, end: size - TAG_BYTES - 1 }),
      decipher,
      createWriteStream(destination, { flags: 'wx', mode: 0o600 }),
    );
  } catch {
    await rm(destination, { force: true });
    throw new BackupError('Could not open backup. Check its password and file integrity.');
  } finally {
    key?.fill(0);
    await handle.close();
  }
}
