import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NotesVault } from './notes-vault.js';

let root: string;
let vault: NotesVault;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'popy-vault-'));
  vault = new NotesVault(join(root, 'notes'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('NotesVault', () => {
  it('writes a note, then reads it back and lists it', () => {
    const saved = vault.write('groceries/week.md', '- milk\n- coffee');

    expect(saved).toBe('groceries/week.md');
    expect(vault.read('groceries/week.md')).toBe('- milk\n- coffee');
    expect(vault.list()).toEqual(['groceries/week.md']);
    expect(vault.count()).toBe(1);
  });

  it('searches across notes and returns matching lines', () => {
    vault.write('a.md', 'buy milk\nand bread');
    vault.write('b.md', 'call the plumber');

    const hits = vault.search('milk');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ path: 'a.md', line: 1, text: 'buy milk' });
  });

  it('caps a huge note on read', () => {
    vault.write('big.md', 'x'.repeat(100 * 1024));
    expect(vault.read('big.md').endsWith('…[truncated]')).toBe(true);
  });

  it('refuses to read outside the vault', () => {
    expect(() => vault.read('../../etc/passwd.md')).toThrow();
  });
});
