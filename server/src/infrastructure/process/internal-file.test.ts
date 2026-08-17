import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createExclusiveInternalFile } from './internal-file.js';

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pop-internal-file-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('exclusive internal files', () => {
  it('redraws after a collision without replacing the existing file', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'audio_existing.wav'), 'keep me');
    const names = ['audio_existing.wav', 'audio_fresh.wav'];

    const created = createExclusiveInternalFile(
      dir,
      'audio',
      'wav',
      'new bytes',
      () => names.shift() ?? 'audio_fallback.wav',
    );

    expect(created).toBe(join(dir, 'audio_fresh.wav'));
    expect(readFileSync(join(dir, 'audio_existing.wav'), 'utf8')).toBe('keep me');
    expect(readFileSync(created, 'utf8')).toBe('new bytes');
    expect(statSync(created).mode & 0o777).toBe(0o600);
  });

  it('propagates filesystem failures other than a collision', () => {
    expect(() =>
      createExclusiveInternalFile(join(tempDir(), 'missing'), 'audio', 'wav'),
    ).toThrow();
  });
});
