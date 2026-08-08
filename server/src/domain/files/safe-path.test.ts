import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanRelative, isHiddenPath, resolveInFiles } from './safe-path.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pop-safe-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('cleanRelative', () => {
  it('normalizes separators and trailing slashes', () => {
    expect(cleanRelative('reports\\2026\\a.pdf')).toBe('reports/2026/a.pdf');
    expect(cleanRelative('reports/')).toBe('reports');
  });

  it('refuses empty, absolute, dotted and null-byte paths', () => {
    expect(() => cleanRelative('')).toThrow();
    expect(() => cleanRelative('  ')).toThrow();
    expect(() => cleanRelative('/etc/passwd')).toThrow();
    expect(() => cleanRelative('../up.txt')).toThrow();
    expect(() => cleanRelative('a/../b.txt')).toThrow();
    expect(() => cleanRelative('a/./b.txt')).toThrow();
    expect(() => cleanRelative('a\0b')).toThrow();
  });
});

describe('resolveInFiles', () => {
  it('resolves a path that does not exist yet -- a write creates it', () => {
    expect(resolveInFiles(root, 'new-dir/new-file.txt')).toBe(join(root, 'new-dir/new-file.txt'));
  });

  it('refuses a symlinked ancestor that escapes the root', () => {
    const outside = mkdtempSync(join(tmpdir(), 'pop-safe-out-'));
    symlinkSync(outside, join(root, 'escape'));
    expect(() => resolveInFiles(root, 'escape/loot.txt')).toThrow();
    rmSync(outside, { recursive: true, force: true });
  });

  it('accepts a real nested path inside the root', () => {
    mkdirSync(join(root, 'a/b'), { recursive: true });
    writeFileSync(join(root, 'a/b/c.txt'), 'x');
    expect(resolveInFiles(root, 'a/b/c.txt')).toBe(join(root, 'a/b/c.txt'));
  });
});

describe('isHiddenPath', () => {
  it('flags any dotted segment, anywhere', () => {
    expect(isHiddenPath('.garbage.json')).toBe(true);
    expect(isHiddenPath('a/.hidden/b.txt')).toBe(true);
    expect(isHiddenPath('a/b.txt')).toBe(false);
  });
});
