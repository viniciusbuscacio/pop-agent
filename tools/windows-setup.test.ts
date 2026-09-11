import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { setupPayload } from './windows-setup.js';

describe('Windows Wails setup payload', () => {
  const bytes = Buffer.from('MZ-fixture');
  const artifact = { file: 'tray.exe', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  it('pins the embedded bytes rather than trusting their filename', () => {
    expect(setupPayload(bytes, artifact, 'tray')).toEqual(artifact);
    expect(setupPayload(bytes, artifact, 'launcher').file).toBe('launcher.exe');
  });
  it('rejects mismatched size/hash and non-executables', () => {
    expect(() => setupPayload(bytes, { ...artifact, size: 1 }, 'tray')).toThrow();
    expect(() => setupPayload(bytes, { ...artifact, sha256: '0'.repeat(64) }, 'tray')).toThrow();
    expect(() => setupPayload(Buffer.from('html-page!'), artifact, 'tray')).toThrow();
  });
});
