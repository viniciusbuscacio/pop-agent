import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SECRET_KEY_BYTES } from '../../application/crypto/secret-box.js';
import { loadOrCreateSecretKey } from './secret-key-file.js';

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pop-key-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('secret key file', () => {
  it('creates a 32-byte key on first boot and reuses it afterwards', () => {
    const file = join(tempDir(), 'secret.key');

    const created = loadOrCreateSecretKey(file);
    expect(created).toHaveLength(SECRET_KEY_BYTES);
    expect(loadOrCreateSecretKey(file).equals(created)).toBe(true);
  });

  it('creates the key readable only by its owner', () => {
    const file = join(tempDir(), 'secret.key');
    loadOrCreateSecretKey(file);

    // Windows does not model POSIX permission bits; the server is Linux.
    if (process.platform !== 'win32') {
      expect(statSync(file).mode & 0o777).toBe(0o600);
    }
  });

  it('refuses a truncated key instead of silently generating a new one', () => {
    const file = join(tempDir(), 'secret.key');
    writeFileSync(file, Buffer.alloc(8));

    expect(() => loadOrCreateSecretKey(file)).toThrow(/exactly 32 bytes/);
  });
});
